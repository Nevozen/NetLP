import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { compareEntries, replay } from "@/domain/ledger";
import {
  address,
  eventSchema,
  type Entry,
  type EventFacts,
  marketSchema,
  type Market,
  note,
  timestamp,
  vectorSchema,
  type PriceVector,
  walletOriginSchema,
} from "@/domain/model";
import { evaluate, type Evaluation } from "@/domain/performance";
import { AccountingError, requireFact, validateVector } from "@/domain/values";

const uuid = z.uuid();
export const metadataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: z.string().trim().min(1).max(120),
  notes: note.optional(),
  walletAddress: address.optional(),
  positionRef: z.string().trim().min(1).max(120).optional(),
});
export type StrategyMetadata = z.infer<typeof metadataSchema>;
const submission = z.object({
  at: timestamp,
  facts: eventSchema,
  prices: vectorSchema,
});
type Posting = z.infer<typeof submission>;
const walletGroup = z.object({
  origin: walletOriginSchema,
  at: timestamp,
  revision: z.number().int().positive(),
  facts: z.array(eventSchema).min(1).max(12),
  prices: vectorSchema,
});
const walletGroups = z.array(walletGroup).min(1).max(10);
export type WalletGroup = z.infer<typeof walletGroup>;
const walletReview = z.object({
  groups: walletGroups,
  address,
  generation: z.number().int().positive(),
  journalVersion: z.string().length(64),
});
type Correction = { eventId: string; version: number; reason: string };
type Client = Prisma.TransactionClient;
const revisionInclude = {
  orderBy: { version: "desc" },
  take: 1,
  include: { prices: true },
} as const;
const bundle = {
  events: {
    orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }],
    include: { revisions: revisionInclude },
  },
  quotes: {
    where: { purpose: "MARK" },
    orderBy: [{ at: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 1,
  },
  final: { include: { prices: true } },
} satisfies Prisma.StrategyInclude;
type Row = Prisma.StrategyGetPayload<{ include: typeof bundle }>;
const journalDraft = z.record(
  z
    .string()
    .regex(/^[a-zA-Z0-9:_-]+$/)
    .max(80),
  z.string().max(2000),
);

export class MissingRecord extends Error {}

function canonical(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(canonical);
  if (!data || typeof data !== "object") return data;
  return Object.fromEntries(
    Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, canonical(value)]),
  );
}

function digest(data: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
}

function inputJson(data: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

function postedDigest(posting: Posting) {
  const { prices, ...facts } = posting;
  return {
    ...facts,
    prices: prices
      .map((q) =>
        q.quality === "MANUAL"
          ? {
              asset: q.asset,
              source: q.source,
              usd: q.usd,
              note: q.note,
              observedAt: q.observedAt,
            }
          : { asset: q.asset, requestedAt: q.requestedAt },
      )
      .sort((a, b) => a.asset.localeCompare(b.asset)),
  };
}

function decodeEvents(row: Row) {
  return row.events
    .map((event) => {
      const revision = event.revisions[0];
      if (!revision || revision.format !== 1)
        throw new Error("Unsupported journal input format.");
      const entry: Entry = {
        id: event.id,
        sequence: event.sequence,
        at: revision.occurredAt.toISOString(),
        facts: eventSchema.parse(revision.facts),
        prices: vectorSchema.parse(revision.prices.quotes),
        walletOrigin: event.walletOrigin
          ? walletOriginSchema.parse(event.walletOrigin)
          : undefined,
      };
      return {
        entry,
        version: revision.version,
        revisionId: revision.id,
        priceSetId: revision.priceSetId,
      };
    })
    .sort((a, b) => compareEntries(a.entry, b.entry));
}

function strategyView(row: Row, now = new Date().toISOString()) {
  const market = marketSchema.parse(row.market);
  const events = decodeEvents(row);
  const ledger = replay(
    market,
    events.map((event) => event.entry),
  );
  const latest = ledger.results.at(-1)!.entry;
  const saved = row.quotes[0];
  const mark = row.final
    ? {
        at: row.final.at.toISOString(),
        type: "FROZEN" as const,
        prices: vectorSchema.parse(row.final.prices.quotes),
      }
    : saved && saved.at.toISOString() >= latest.at
      ? {
          at: saved.at.toISOString(),
          type: "SAVED" as const,
          prices: vectorSchema.parse(saved.quotes),
        }
      : { at: latest.at, type: "EVENT" as const, prices: latest.prices };
  const evaluation = row.final
    ? (row.final.results as unknown as Evaluation)
    : evaluate(market, ledger, mark.at, mark.prices, now);
  const {
    id,
    name,
    protocol,
    notes,
    walletAddress,
    positionRef,
    openedAt,
    closedAt,
  } = row;
  return {
    id,
    name,
    protocol,
    notes,
    walletAddress,
    positionRef,
    openedAt,
    closedAt,
    market,
    events,
    mark,
    evaluation,
    ledger,
    journalVersion: walletJournalVersion(row),
  };
}

export type StrategyView = ReturnType<typeof strategyView>;

async function getRow(db: Client, ownerId: string, id: string) {
  if (!uuid.safeParse(id).success) throw new MissingRecord();
  const row = await db.strategy.findFirst({
    where: { id, ownerId },
    include: bundle,
  });
  if (!row) throw new MissingRecord();
  return row;
}

async function lockStrategy(tx: Client, ownerId: string, id: string) {
  if (!uuid.safeParse(id).success) throw new MissingRecord();
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Strategy" WHERE id = ${id}::uuid AND "ownerId" = ${ownerId} FOR UPDATE`;
  if (!rows.length) throw new MissingRecord();
}

async function lockOwner(tx: Client, ownerId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
}

function checkWalletTime(entries: Entry[], next: Entry) {
  if (
    next.facts.kind === "OPENING_ALLOCATION" ||
    next.facts.kind === "CLOSE_STRATEGY"
  )
    return;
  requireFact(
    !entries.some(
      (e) =>
        e.id !== next.id &&
        e.at === next.at &&
        e.facts.kind !== "OPENING_ALLOCATION" &&
        Boolean(e.walletOrigin) !== Boolean(next.walletOrigin),
    ),
    "An imported and a manual event have the same timestamp. Resolve their order in the journal before posting.",
  );
}

function indexFields(entry: Entry) {
  const { facts } = entry;
  return {
    kind: facts.kind,
    occurredAt: new Date(entry.at),
    txHash: facts.txHash ?? null,
    actionIndex: facts.actionIndex ?? null,
    hasNetworkFee: Boolean(facts.txHash && facts.gas === "RECORDED"),
  };
}

function candidate(
  row: Row,
  posting: Posting,
  id: string,
  replaces?: Correction,
) {
  const market = marketSchema.parse(row.market);
  const events = decodeEvents(row);
  const prior =
    replaces && events.find(({ entry }) => entry.id === replaces.eventId);
  if (replaces) {
    requireFact(
      prior && prior.version === replaces.version,
      "This event has changed. Reload it before correcting.",
    );
    requireFact(
      prior.entry.facts.kind === posting.facts.kind,
      "A correction must keep the original event type.",
    );
    if (prior.entry.walletOrigin) {
      requireFact(
        prior.entry.at === posting.at &&
          prior.entry.facts.txHash === posting.facts.txHash &&
          prior.entry.facts.actionIndex === posting.facts.actionIndex,
        "A correction to an on-chain event must keep its original timestamp, hash and action index.",
      );
    }
  } else {
    requireFact(
      posting.facts.kind !== "OPENING_ALLOCATION",
      "A strategy already has its opening allocation.",
    );
    requireFact(
      events.length < 5000,
      "This cycle has reached its journal limit. Close it and start a new cycle.",
    );
  }
  requireFact(!row.closedAt, "Closed cycles are frozen and cannot be changed.");
  requireFact(
    posting.facts.kind !== "CLOSE_STRATEGY" ||
      posting.at >= events.at(-1)!.entry.at,
    "Closure cannot precede a posted event.",
  );
  const newEntry: Entry = {
    ...posting,
    id: prior ? prior.entry.id : id,
    walletOrigin: prior?.entry.walletOrigin,
    sequence: prior
      ? prior.entry.sequence
      : events.reduce((max, event) => Math.max(max, event.entry.sequence), 0) +
        1,
  };
  checkWalletTime(
    events.map(({ entry }) => entry),
    newEntry,
  );
  const ledger = replay(market, [
    ...events
      .filter((event) => event.entry.id !== newEntry.id)
      .map((event) => event.entry),
    newEntry,
  ]);
  const latest = ledger.results.at(-1)!.entry;
  const evaluation = evaluate(market, ledger, latest.at, latest.prices);
  if (ledger.closedAt)
    requireFact(
      evaluation.totalPnl !== null && evaluation.outperformance !== null,
      "Add the missing opening and closing prices before freezing performance.",
    );
  return {
    newEntry,
    ledger,
    evaluation,
    events,
    prior,
    line: ledger.results.find((line) => line.entry.id === newEntry.id)!,
  };
}

function walletJournalVersion(row: Row) {
  return digest({
    revisions: row.events.map((event) => event.revisions[0]?.id),
    wallet: row.walletAddress,
    position: row.positionRef,
    protocol: row.protocol,
    mark: row.quotes[0]?.id,
    closed: Boolean(row.closedAt),
  });
}

async function walletEntries(
  tx: Client,
  row: Row,
  watch: { address: string; generation: number },
  groups: WalletGroup[],
) {
  requireFact(
    !row.closedAt && row.chainId === "8453",
    "Choose an open Base strategy for this batch.",
  );
  requireFact(
    !row.walletAddress || row.walletAddress === watch.address,
    "The strategy is linked to a different wallet.",
  );
  const current = await tx.walletWatch.findFirst({
    where: {
      ownerId: row.ownerId,
      chainId: row.chainId,
      address: watch.address,
      generation: watch.generation,
    },
  });
  requireFact(
    current,
    "The watched wallet changed. Select the transactions again.",
  );
  const ids = groups.map((group) => group.origin.activityId);
  requireFact(
    new Set(ids).size === ids.length,
    "Select each transaction only once.",
  );
  const activity = await tx.walletActivity.findMany({
    where: {
      ownerId: row.ownerId,
      chainId: row.chainId,
      address: watch.address,
      id: { in: ids },
      ignored: false,
      status: { in: ["READY", "NEEDS_REVIEW"] },
    },
  });
  const byId = new Map(activity.map((a) => [a.id, a]));
  const hashes = groups.map(({ origin, revision, facts, at }) => {
    const a = byId.get(origin.activityId);
    requireFact(
      a &&
        a.revision === revision &&
        a.blockNumber?.toString() === origin.blockNumber &&
        a.blockHash === origin.blockHash &&
        a.txIndex === origin.txIndex &&
        a.occurredAt?.toISOString() === at,
      "Wallet evidence changed or a transaction was already posted. Refresh the review.",
    );
    requireFact(
      facts.every(
        (fact) =>
          fact.txHash === a.txHash &&
          !["OPENING_ALLOCATION", "CLOSE_STRATEGY"].includes(fact.kind),
      ),
      "The batch must contain actions for its verified transactions only.",
    );
    requireFact(
      facts[0].gas === "RECORDED"
        ? facts.slice(1).every((fact) => fact.gas === "SHARED")
        : facts.every((fact) => fact.gas === "UNKNOWN"),
      "Record the receipt fee once, or leave the entire receipt fee unresolved.",
    );
    return a.txHash;
  });
  requireFact(
    !(await tx.journalEvent.findFirst({
      where: {
        ownerId: row.ownerId,
        chainId: row.chainId,
        txHash: { in: hashes },
      },
      select: { id: true },
    })),
    "An on-chain transaction is already in your journal. Review the existing entry instead.",
  );
  const existing = decodeEvents(row).map(({ entry }) => entry);
  let sequence = existing.reduce(
    (max, entry) => Math.max(max, entry.sequence),
    0,
  );
  const entries = groups.flatMap((group) =>
    group.facts.map((facts): Entry => ({
      id: randomUUID(),
      sequence: ++sequence,
      at: group.at,
      facts,
      prices: group.prices,
      walletOrigin: group.origin,
    })),
  );
  requireFact(
    existing.length + entries.length <= 5000,
    "This batch exceeds the strategy journal limit.",
  );
  for (const entry of entries) checkWalletTime(existing, entry);
  const ledger = replay(marketSchema.parse(row.market), [
    ...existing,
    ...entries,
  ]);
  return { entries, ledger };
}

async function persistence<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AccountingError(
        "Duplicate request, transaction action, network fee, or linked position. Check the existing journal.",
      );
    }
    throw error;
  }
}

export function createJournal(db: PrismaClient) {
  return {
    get: (ownerId: string, id: string) =>
      db.$transaction(
        async (tx) => strategyView(await getRow(tx, ownerId, id)),
        { isolationLevel: "RepeatableRead" },
      ),
    list: (ownerId: string) =>
      db.$transaction(
        async (tx) => {
          const rows = await tx.strategy.findMany({
            where: { ownerId },
            include: bundle,
            orderBy: { openedAt: "desc" },
          });
          const now = new Date().toISOString();
          return rows.map((row) => strategyView(row, now));
        },
        { isolationLevel: "RepeatableRead" },
      ),
    async history(ownerId: string, id: string, eventId: string) {
      if (!uuid.safeParse(id).success || !uuid.safeParse(eventId).success)
        throw new MissingRecord();
      const event = await db.journalEvent.findFirst({
        where: { id: eventId, strategyId: id, ownerId },
        include: {
          revisions: {
            orderBy: { version: "desc" },
            include: { prices: true },
          },
        },
      });
      if (!event) throw new MissingRecord();
      return event.revisions.map((r) => ({
        version: r.version,
        reason: r.reason,
        at: r.occurredAt.toISOString(),
        recorded: r.createdAt.toISOString(),
        facts: eventSchema.parse(r.facts),
        prices: vectorSchema.parse(r.prices.quotes),
      }));
    },
    async create(
      ownerId: string,
      id: string,
      market: Market,
      metadata: StrategyMetadata,
      post: Posting,
    ) {
      uuid.parse(id);
      const config = marketSchema.parse(market);
      const details = metadataSchema.parse(metadata);
      const data = submission.parse(post);
      requireFact(
        data.facts.kind === "OPENING_ALLOCATION",
        "A strategy starts with an opening allocation.",
      );
      replay(config, [{ id, sequence: 1, ...data }]);
      const requestDigest = digest({
        config,
        details,
        post: postedDigest(data),
      });
      return persistence(() =>
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
          const existing = await tx.strategy.findFirst({
            where: { id, ownerId },
            select: { requestDigest: true },
          });
          if (existing) {
            requireFact(
              existing.requestDigest === requestDigest,
              "This opening request was already used with different inputs.",
            );
            return id;
          }
          await tx.strategy.create({
            data: {
              ...details,
              id,
              ownerId,
              chainId: config.chainId,
              market: inputJson(config),
              requestDigest,
              openedAt: new Date(data.at),
            },
          });
          const prices = await tx.priceSet.create({
            data: {
              strategyId: id,
              at: new Date(data.at),
              purpose: "EVENT",
              quotes: inputJson(data.prices),
            },
          });
          await tx.journalEvent.create({
            data: {
              id,
              ownerId,
              strategyId: id,
              chainId: config.chainId,
              sequence: 1,
              ...indexFields({ id, sequence: 1, ...data }),
            },
          });
          await tx.eventRevision.create({
            data: {
              id,
              strategyId: id,
              eventId: id,
              version: 1,
              occurredAt: new Date(data.at),
              facts: inputJson(data.facts),
              priceSetId: prices.id,
              actorId: ownerId,
              digest: requestDigest,
            },
          });
          return id;
        }),
      );
    },
    async preview(
      ownerId: string,
      strategyId: string,
      commandId: string,
      post: Posting,
      replaces?: Correction,
    ) {
      const row = await db.$transaction(
        (tx) => getRow(tx, ownerId, strategyId),
        { isolationLevel: "RepeatableRead" },
      );
      return candidate(
        row,
        submission.parse(post),
        uuid.parse(commandId),
        replaces,
      );
    },
    async previewWallet(
      ownerId: string,
      strategyId: string,
      watch: { address: string; generation: number },
      input: WalletGroup[],
      journalVersion: string,
    ) {
      const groups = walletGroups.parse(input);
      return db.$transaction(
        async (tx) => {
          await lockOwner(tx, ownerId);
          await lockStrategy(tx, ownerId, strategyId);
          await tx.$queryRaw`SELECT 1 FROM "WalletWatch" WHERE "ownerId" = ${ownerId} AND "chainId" = '8453' FOR UPDATE`;
          const row = await getRow(tx, ownerId, strategyId);
          requireFact(
            walletJournalVersion(row) === journalVersion,
            "The strategy changed while pricing this batch. Preview it again.",
          );
          const { ledger } = await walletEntries(tx, row, watch, groups);
          const now = new Date();
          await tx.walletImportReview.deleteMany({
            where: { ownerId, expiresAt: { lt: now } },
          });
          requireFact(
            (await tx.walletImportReview.count({
              where: { ownerId, postedAt: null },
            })) < 30,
            "Too many recent previews. Open an existing preview or wait for it to expire.",
          );
          const { id } = await tx.walletImportReview.create({
            data: {
              ownerId,
              chainId: row.chainId,
              strategyId,
              expiresAt: new Date(+now + 20 * 60_000),
              data: inputJson({
                groups,
                address: watch.address,
                generation: watch.generation,
                journalVersion,
              }),
            },
          });
          const latest = ledger.results.at(-1)!.entry;
          const saved = row.quotes[0];
          const mark =
            saved && saved.at.toISOString() >= latest.at
              ? {
                  at: saved.at.toISOString(),
                  prices: vectorSchema.parse(saved.quotes),
                }
              : latest;
          return {
            id,
            ledger,
            evaluation: evaluate(
              marketSchema.parse(row.market),
              ledger,
              mark.at,
              mark.prices,
              now.toISOString(),
            ),
          };
        },
        { timeout: 10_000 },
      );
    },
    async postWallet(
      ownerId: string,
      reviewId: string,
      checkFinal: (
        group: WalletGroup,
        context: { ownerId: string; address: string },
      ) => Promise<void>,
    ) {
      if (!uuid.safeParse(reviewId).success) throw new MissingRecord();
      const review = await db.walletImportReview.findFirst({
        where: { id: reviewId, ownerId },
      });
      if (!review) throw new MissingRecord();
      if (review.postedAt) return review.strategyId;
      requireFact(
        review.expiresAt.getTime() > Date.now(),
        "This review expired. Preview the batch again.",
      );
      const details = walletReview.parse(review.data);
      for (const group of details.groups)
        await checkFinal(group, { ownerId, address: details.address });
      return persistence(() =>
        db.$transaction(
          async (tx) => {
            await lockOwner(tx, ownerId);
            await lockStrategy(tx, ownerId, review.strategyId);
            const current = await tx.walletImportReview.findUnique({
              where: { id: review.id },
            });
            requireFact(
              current,
              "This review expired. Preview the batch again.",
            );
            if (current.postedAt) return review.strategyId;
            requireFact(
              current.expiresAt.getTime() > Date.now(),
              "This review expired. Preview the batch again.",
            );
            await tx.$queryRaw`SELECT 1 FROM "WalletWatch" WHERE "ownerId" = ${ownerId} AND "chainId" = ${review.chainId} FOR UPDATE`;
            const row = await getRow(tx, ownerId, review.strategyId);
            requireFact(
              walletJournalVersion(row) === details.journalVersion,
              "The strategy changed. Preview the batch again.",
            );
            const { entries } = await walletEntries(
              tx,
              row,
              details,
              details.groups,
            );
            const byActivity = new Map<string, Entry[]>();
            for (const entry of entries) {
              const key = entry.walletOrigin!.activityId;
              const items = byActivity.get(key);
              if (items) items.push(entry);
              else byActivity.set(key, [entry]);
            }
            for (const group of details.groups) {
              const items = byActivity.get(group.origin.activityId)!;
              const { id: priceSetId } = await tx.priceSet.create({
                data: {
                  strategyId: row.id,
                  at: new Date(group.at),
                  purpose: "EVENT",
                  quotes: inputJson(group.prices),
                },
              });
              await tx.journalEvent.createMany({
                data: items.map((entry) => ({
                  id: entry.id,
                  strategyId: row.id,
                  ownerId,
                  chainId: row.chainId,
                  sequence: entry.sequence,
                  walletOrigin: inputJson(group.origin),
                  ...indexFields(entry),
                })),
              });
              await tx.eventRevision.createMany({
                data: items.map((entry) => ({
                  id: entry.id,
                  strategyId: row.id,
                  eventId: entry.id,
                  version: 1,
                  digest: digest(postedDigest(entry)),
                  facts: inputJson(entry.facts),
                  occurredAt: new Date(entry.at),
                  priceSetId,
                  actorId: ownerId,
                })),
              });
              const touched = await tx.walletActivity.updateMany({
                where: {
                  id: group.origin.activityId,
                  ownerId,
                  revision: group.revision,
                  ignored: false,
                },
                data: {
                  status: "POSTED",
                  postedStrategyId: row.id,
                  postedEventIds: items.map((entry) => entry.id),
                  revision: { increment: 1 },
                },
              });
              requireFact(
                touched.count === 1,
                "Wallet evidence changed. Preview the batch again.",
              );
            }
            await tx.walletImportReview.update({
              where: { id: review.id },
              data: { postedAt: new Date(), data: Prisma.DbNull },
            });
            return row.id;
          },
          { timeout: 15_000 },
        ),
      );
    },
    async post(
      ownerId: string,
      strategyId: string,
      commandId: string,
      post: Posting,
      replaces?: Correction,
    ) {
      uuid.parse(commandId);
      if (replaces) {
        uuid.parse(replaces.eventId);
        z.number().int().positive().parse(replaces.version);
        z.string().trim().min(3).max(2000).parse(replaces.reason);
      }
      const data = submission.parse(post);
      const key = digest({ post: postedDigest(data), replaces });
      return persistence(() =>
        db.$transaction(async (tx) => {
          await lockOwner(tx, ownerId);
          await lockStrategy(tx, ownerId, strategyId);
          const seen = await tx.eventRevision.findFirst({
            where: { id: commandId, strategyId },
            select: { digest: true, eventId: true },
          });
          if (seen) {
            requireFact(
              seen.digest === key,
              "This journal request was already used with different inputs.",
            );
            return seen.eventId;
          }
          const row = await getRow(tx, ownerId, strategyId);
          const imported =
            replaces &&
            row.events.some(
              (event) => event.id === replaces.eventId && event.walletOrigin,
            );
          if (data.facts.txHash && !imported) {
            requireFact(
              !(await tx.journalEvent.findFirst({
                where: {
                  ownerId,
                  chainId: row.chainId,
                  txHash: data.facts.txHash,
                  walletOrigin: { not: Prisma.DbNull },
                },
                select: { id: true },
              })),
              "This transaction was already imported as a receipt group.",
            );
          }
          const { newEntry, evaluation, events, ledger, prior } = candidate(
            row,
            data,
            commandId,
            replaces,
          );
          const { id: eventId, sequence } = newEntry;
          const prices = await tx.priceSet.create({
            data: {
              strategyId,
              at: new Date(data.at),
              purpose: "EVENT",
              quotes: inputJson(data.prices),
            },
          });
          if (prior) {
            await tx.journalEvent.update({
              where: { id: eventId },
              data: indexFields(newEntry),
            });
          } else {
            await tx.journalEvent.create({
              data: {
                id: eventId,
                strategyId,
                ownerId,
                chainId: row.chainId,
                sequence,
                ...indexFields(newEntry),
              },
            });
          }
          await tx.eventRevision.create({
            data: {
              id: commandId,
              strategyId,
              eventId,
              version: (prior?.version ?? 0) + 1,
              digest: key,
              facts: inputJson(data.facts),
              occurredAt: new Date(data.at),
              priceSetId: prices.id,
              reason: replaces?.reason,
              actorId: ownerId,
            },
          });
          await tx.journalDraft.deleteMany({
            where: { id: commandId, strategyId },
          });
          if (newEntry.facts.kind === "OPENING_ALLOCATION") {
            await tx.strategy.update({
              where: { id: strategyId },
              data: { openedAt: new Date(data.at) },
            });
          }
          if (ledger.closedAt) {
            const references = new Map(
              events.map((event) => [event.entry.id, event.revisionId]),
            );
            references.set(eventId, commandId);
            await tx.finalEvaluation.create({
              data: {
                strategyId,
                at: new Date(ledger.closedAt),
                version: evaluation.version,
                priceSetId: prices.id,
                revisionIds: inputJson(
                  ledger.results.map((line) => references.get(line.entry.id)),
                ),
                results: inputJson(evaluation),
              },
            });
            await tx.strategy.update({
              where: { id: strategyId },
              data: { closedAt: new Date(ledger.closedAt) },
            });
          }
          return eventId;
        }),
      );
    },
    async saveMark(
      ownerId: string,
      strategyId: string,
      at: string,
      prices: PriceVector,
      id: string,
    ) {
      timestamp.parse(at);
      vectorSchema.parse(prices);
      uuid.parse(id);
      return persistence(() =>
        db.$transaction(async (tx) => {
          await lockStrategy(tx, ownerId, strategyId);
          const strategy = await tx.strategy.findUniqueOrThrow({
            where: { id: strategyId },
          });
          requireFact(!strategy.closedAt, "Closing prices are frozen.");
          requireFact(
            at >= strategy.openedAt.toISOString(),
            "A mark cannot predate the opening allocation.",
          );
          validateVector(marketSchema.parse(strategy.market), at, prices);
          const prior = await tx.priceSet.findFirst({
            where: { id, strategyId, purpose: "MARK" },
          });
          if (prior) return prior.id;
          await tx.priceSet.create({
            data: {
              id,
              strategyId,
              at: new Date(at),
              purpose: "MARK",
              quotes: inputJson(prices),
            },
          });
          return id;
        }),
      );
    },
    async editMetadata(
      ownerId: string,
      strategyId: string,
      metadata: StrategyMetadata,
    ) {
      if (!uuid.safeParse(strategyId).success) throw new MissingRecord();
      const data = metadataSchema.parse(metadata);
      const { count } = await persistence(() =>
        db.strategy.updateMany({
          where: { ownerId, id: strategyId },
          data: {
            ...data,
            notes: data.notes ?? null,
            walletAddress: data.walletAddress ?? null,
            positionRef: data.positionRef ?? null,
          },
        }),
      );
      if (!count) throw new MissingRecord();
    },
    async saveDraft(
      ownerId: string,
      strategyId: string,
      id: string,
      fields: Record<string, string>,
    ) {
      uuid.parse(id);
      const safe = journalDraft.parse(fields);
      requireFact(
        Object.entries(safe).length <= 120 &&
          JSON.stringify(safe).length <= 32_000,
        "This draft is too large.",
      );
      return persistence(() =>
        db.$transaction(async (tx) => {
          await lockStrategy(tx, ownerId, strategyId);
          const open = await tx.strategy.findFirst({
            where: { id: strategyId, ownerId, closedAt: null },
            select: { id: true },
          });
          requireFact(open, "Closed cycles cannot accept drafts.");
          const posted = await tx.eventRevision.findUnique({
            where: { id },
            select: { id: true },
          });
          requireFact(!posted, "This draft has already been posted.");
          await tx.journalDraft.upsert({
            where: { id, strategyId },
            create: { id, strategyId, fields: inputJson(safe) },
            update: { fields: inputJson(safe) },
          });
        }),
      );
    },
    async drafts(ownerId: string, strategyId: string) {
      if (!uuid.safeParse(strategyId).success) throw new MissingRecord();
      const rows = await db.journalDraft.findMany({
        where: { strategyId, strategy: { ownerId, closedAt: null } },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt,
        fields: journalDraft.parse(row.fields),
      }));
    },
  };
}

export type Journal = ReturnType<typeof createJournal>;
export type { Posting, Correction, EventFacts };
