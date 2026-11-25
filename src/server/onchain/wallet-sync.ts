import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { WalletStatus } from "@/generated/prisma/enums";
import { verifyActivity, type VerifiedActivity } from "./activity";
import { alchemyDiscovery, type WalletDiscovery } from "./alchemy";
import {
  baseEndpoints,
  baseReader,
  ProviderError,
  rpcTransport,
  type BaseReader,
  type ChainBlock,
} from "./base-rpc";
import { lockWatch, queueHashes, walletScope, watchKey } from "./wallet-store";

export const RECENT_BLOCKS = 10_000n;
const WINDOW = 10_000n;
const OVERLAP = 1500n;
const BATCH = 6;
const MIN_INTERVAL = 15_000;
const LEASE_TIME = 55_000;
const BACKOFF = 2 * 60_000;
const MAX_BACKOFF = 20 * 60_000;
const MAX_PENDING = 1000;
const pendingStatuses = ["DETECTED", "CONFIRMING"] satisfies WalletStatus[];

const cursorSchema = z.object({
  from: z.string().regex(/^\d{1,24}$/),
  to: z.string().regex(/^\d{1,24}$/),
  direction: z.enum(["out", "in"]),
  pageKey: z.string().min(1).max(256).optional(),
});
type Cursor = z.infer<typeof cursorSchema>;

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

export function scanRange(
  start: bigint,
  next: bigint,
  head: bigint,
): Cursor | null {
  const from = max(start, next - OVERLAP);
  if (from > head) return null;
  return {
    from: from.toString(),
    to: min(head, from + WINDOW - 1n).toString(),
    direction: "out",
  };
}

export function scanPage(cursor: Cursor, key?: string) {
  if (key) return { cursor: { ...cursor, pageKey: key } };
  if (cursor.direction === "out")
    return {
      cursor: {
        from: cursor.from,
        to: cursor.to,
        direction: "in",
      } satisfies Cursor,
    };
  return { cursor: null, through: BigInt(cursor.to) + 1n };
}

export type Classify = (
  rpc: BaseReader,
  tx: VerifiedActivity,
) => Promise<{
  status: Extract<WalletStatus, "ACTIVITY_ONLY" | "NEEDS_REVIEW" | "READY">;
  draft?: Prisma.InputJsonObject;
}>;
class LeaseLost extends Error {}

export function walletProvider(signal?: AbortSignal) {
  const { rpc, indexer } = baseEndpoints();
  return {
    rpc: rpc ? baseReader(rpcTransport(rpc, signal)) : null,
    discover:
      rpc && indexer ? alchemyDiscovery(rpcTransport(indexer, signal)) : null,
  };
}

export function createWalletSync(
  db: PrismaClient,
  {
    rpc,
    discover,
    classify,
    signal,
  }: {
    rpc: BaseReader | null;
    discover: WalletDiscovery | null;
    classify?: Classify;
    signal?: AbortSignal;
  },
  clock = () => new Date(),
) {
  return async (ownerId: string) => {
    if (!rpc || signal?.aborted) return;
    const lease = randomUUID();
    const start = clock();
    const watch = await db.$transaction(async (tx) => {
      const current = await lockWatch(tx, ownerId);
      if (
        !current ||
        signal?.aborted ||
        (current.leaseUntil && current.leaseUntil > start) ||
        (current.nextSyncAt && current.nextSyncAt > start)
      )
        return null;
      if (!discover || !current.enabled) {
        const work = await tx.walletActivity.findFirst({
          where: {
            ...walletScope(ownerId, current.address),
            ignored: false,
            status: { in: ["DETECTED", "CONFIRMING"] },
            ...(current.enabled
              ? {}
              : { sources: { hasSome: ["CSV", "HASH"] } }),
          },
          select: { id: true },
        });
        if (!work) return null;
      }
      return tx.walletWatch.update({
        where: watchKey(ownerId),
        data: {
          lease,
          leaseUntil: new Date(+start + LEASE_TIME),
          nextSyncAt: new Date(+start + MIN_INTERVAL),
        },
      });
    });
    if (!watch) return;

    const scope = walletScope(ownerId, watch.address);
    const candidateScope = {
      ...scope,
      ignored: false,
      status: { in: pendingStatuses },
      ...(watch.enabled
        ? {}
        : { sources: { hasSome: ["CSV", "HASH"] as ("CSV" | "HASH")[] } }),
    };
    const commit = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      db.$transaction(async (tx) => {
        const current = await lockWatch(tx, ownerId);
        if (
          current?.lease !== lease ||
          current.generation !== watch.generation ||
          !current.leaseUntil ||
          current.leaseUntil <= clock() ||
          signal?.aborted
        )
          throw new LeaseLost();
        return fn(tx);
      });
    let issue: ProviderError | undefined;
    try {
      await rpc.assertChain();
      if (
        discover &&
        watch.enabled &&
        (await db.walletActivity.count({ where: candidateScope })) < MAX_PENDING
      ) {
        let cursor =
          watch.cursor == null ? null : cursorSchema.parse(watch.cursor);
        try {
          const head = (await rpc.block("latest")).number;
          const anchor =
            watch.startBlock ??
            (watch.recent ? max(0n, head - RECENT_BLOCKS + 1n) : head + 1n);
          let next = watch.nextBlock ?? anchor;
          const startBlock = watch.startBlock ?? anchor;
          if (!cursor) cursor = scanRange(startBlock, next, head);
          for (let pages = 0; cursor && pages < 2; pages++) {
            const page = await discover({
              wallet: watch.address,
              from: BigInt(cursor.from),
              to: BigInt(cursor.to),
              direction: cursor.direction,
              pageKey: cursor.pageKey,
            });
            const step = scanPage(cursor, page.pageKey);
            if (step.through !== undefined) next = max(next, step.through);
            await commit(async (tx) => {
              await queueHashes(tx, scope, page.hashes, "ALCHEMY");
              await tx.walletWatch.update({
                where: watchKey(ownerId),
                data: {
                  startBlock,
                  nextBlock: next,
                  cursor: step.cursor ?? Prisma.DbNull,
                },
              });
            });
            cursor = step.cursor;
          }
          if (watch.startBlock === null && !cursor) {
            await commit((tx) =>
              tx.walletWatch.update({
                where: watchKey(ownerId),
                data: { startBlock, nextBlock: next },
              }),
            );
          }
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          issue = error;
          if (error.kind === "CURSOR" && cursor) {
            const reset = {
              from: cursor.from,
              to: cursor.to,
              direction: "out",
            };
            await commit((tx) =>
              tx.walletWatch.update({
                where: watchKey(ownerId),
                data: { cursor: reset },
              }),
            );
          }
        }
      }

      if (!issue || issue.kind !== "RATE_LIMIT") {
        const any = await db.walletActivity.findFirst({
          where: candidateScope,
          select: { id: true },
        });
        if (any) {
          let finalized = -1n;
          try {
            finalized = (await rpc.block("finalized")).number;
          } catch (error) {
            if (
              !(error instanceof ProviderError) ||
              error.kind === "RATE_LIMIT"
            )
              throw error;
            issue ??= error;
          }
          const candidates = await db.walletActivity.findMany({
            where: {
              ...candidateScope,
              OR: [
                { retryAt: null },
                { retryAt: { lte: start } },
                { status: "CONFIRMING", blockNumber: { lte: finalized } },
              ],
            },
            orderBy: [
              { retryAt: { sort: "asc", nulls: "first" } },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            take: BATCH,
          });
          const blocks = new Map<bigint, Promise<ChainBlock>>();
          const blockAt = (n: bigint) => {
            const cached = blocks.get(n) ?? rpc.block(n);
            blocks.set(n, cached);
            return cached;
          };
          for (const candidate of candidates) {
            if (+clock() - +start > 25_000) break;
            let data: Prisma.WalletActivityUpdateManyMutationInput;
            const clear = {
              blockNumber: null,
              blockHash: null,
              txIndex: null,
              occurredAt: null,
              evidence: Prisma.DbNull,
              draft: Prisma.DbNull,
              topLevel: false,
              hasTokens: false,
              hasNfts: false,
            };
            try {
              const result = await verifyActivity(
                rpc,
                watch.address,
                candidate.txHash,
                finalized,
                blockAt,
              );
              if (result === null) {
                data = {
                  ...clear,
                  status: "DETECTED",
                  attempts: { increment: 1 },
                  retryAt: new Date(
                    +clock() +
                      Math.min(
                        3600_000,
                        30_000 * 2 ** Math.min(candidate.attempts, 7),
                      ),
                  ),
                };
              } else if (result === "UNRELATED") {
                data = { ...clear, status: "UNRELATED", retryAt: null };
              } else {
                const assessment =
                  result.finalized && classify
                    ? await classify(rpc, result)
                    : undefined;
                data = {
                  status: result.finalized
                    ? (assessment?.status ?? "ACTIVITY_ONLY")
                    : "CONFIRMING",
                  retryAt: result.finalized
                    ? null
                    : new Date(+clock() + BACKOFF),
                  attempts: 0,
                  blockNumber: result.block.number,
                  blockHash: result.block.hash,
                  txIndex: result.receipt.transactionIndex,
                  occurredAt: result.at,
                  topLevel: result.topLevel,
                  hasTokens: result.hasTokens,
                  hasNfts: result.hasNfts,
                  evidence: result.evidence,
                  draft: assessment?.draft ?? Prisma.DbNull,
                };
              }
              await commit((tx) =>
                tx.walletActivity.updateMany({
                  where: {
                    ...scope,
                    id: candidate.id,
                    revision: candidate.revision,
                    status: candidate.status,
                  },
                  data: { ...data, revision: { increment: 1 } },
                }),
              );
            } catch (error) {
              if (!(error instanceof ProviderError)) throw error;
              issue ??= error;
              if (error.kind === "RATE_LIMIT" || error.kind === "UNAVAILABLE")
                break;
              await commit((tx) =>
                tx.walletActivity.updateMany({
                  where: {
                    ...scope,
                    id: candidate.id,
                    revision: candidate.revision,
                    status: candidate.status,
                  },
                  data: {
                    retryAt: new Date(+clock() + BACKOFF),
                    attempts: { increment: 1 },
                  },
                }),
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof LeaseLost || signal?.aborted) return;
      if (!(error instanceof ProviderError)) throw error;
      issue ??= error;
    } finally {
      const now = clock();
      await db.walletWatch.updateMany({
        where: {
          ownerId,
          chainId: scope.chainId,
          generation: watch.generation,
          lease,
        },
        data: {
          lease: null,
          leaseUntil: null,
          ...(signal?.aborted
            ? { nextSyncAt: null }
            : issue?.kind === "CURSOR"
              ? {
                  issue: issue.message,
                  nextSyncAt: new Date(+now + MIN_INTERVAL),
                }
              : issue
                ? {
                    issue: issue.message,
                    syncFailures: { increment: 1 },
                    nextSyncAt: new Date(
                      +now +
                        Math.min(
                          MAX_BACKOFF,
                          BACKOFF * 2 ** Math.min(watch.syncFailures, 4),
                        ),
                    ),
                  }
                : { issue: null, syncFailures: 0, lastSyncedAt: now }),
        },
      });
    }
  };
}
