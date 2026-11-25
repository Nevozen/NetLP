import { formatUnits } from "viem";
import { z } from "zod";
import {
  Prisma,
  type PrismaClient,
  type WalletActivity,
  type WalletWatch,
} from "@/generated/prisma/client";
import { presets } from "@/domain/catalog";
import {
  eventSchema,
  knownPair,
  priceText,
  quantity,
  snapshotSchema,
  type EventFacts,
  type Leg,
  type Market,
  type PriceVector,
  type Snapshot,
} from "@/domain/model";
import { AccountingError, D, requireFact } from "@/domain/values";
import { type Fields, field } from "@/server/form-data";
import type { StrategyView, WalletGroup } from "@/server/journal";
import { BASE, type BaseReader } from "./base-rpc";
import { evidenceSchema } from "./activity";
import { pancakeDraftSchema, type PancakeAction } from "./pancake-v3";
import { walletScope } from "./wallet-store";

export const activityIds = z
  .array(z.uuid())
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length);
export const importedProtocol = "PancakeSwap v3";
type GasFunding = "STRATEGY_WALLET" | "EXTERNAL";
const funding = z.enum(["STRATEGY_WALLET", "EXTERNAL"]);
const purpose = z.enum(["ENTRY", "EXIT", "REBALANCE", "OTHER"]);

export function isBasePair(market: Market) {
  return (
    market.chainId === BASE &&
    market.native.decimals === presets.base.native.decimals &&
    presets.base.pair.every((asset) =>
      market.pair.some(
        (token) => asset.id === token.id && asset.decimals === token.decimals,
      ),
    )
  );
}

export function eligibleWalletStrategy(cycle: StrategyView, wallet: string) {
  return (
    !cycle.closedAt &&
    isBasePair(cycle.market) &&
    (!cycle.walletAddress || cycle.walletAddress === wallet)
  );
}

export async function selectedActivity(
  db: PrismaClient,
  watch: WalletWatch,
  ids: string[],
) {
  const selected = activityIds.safeParse(ids);
  requireFact(
    selected.success,
    "Select between one and ten different transactions.",
  );
  const rows = await db.walletActivity.findMany({
    where: {
      ...walletScope(watch.ownerId, watch.address),
      id: { in: selected.data },
      ignored: false,
      status: { in: ["READY", "NEEDS_REVIEW"] },
    },
    orderBy: [
      { occurredAt: "asc" },
      { blockNumber: "asc" },
      { txIndex: "asc" },
    ],
  });
  requireFact(
    rows.length === ids.length &&
      rows.every(
        (row) => pancakeDraftSchema.safeParse(row.draft).data?.actions.length,
      ),
    "Some transactions can no longer be reviewed. Return to Wallet activity and select again.",
  );
  return rows;
}

export function swapField(hashIndex: number, actionIndex: number) {
  return `r${hashIndex}a${actionIndex}`;
}

function readSnapshot(
  op: Extract<PancakeAction, { kind: "ADD" | "COLLECTION" }>,
  prefix: string,
  fields: Fields,
) {
  const snapshot = op.snapshot;
  const manualPair = (name: "principal" | "unclaimed") =>
    [0, 1].map(
      (i) =>
        snapshot?.[name][i] ?? field(fields, `${prefix}${name}${i}`) ?? null,
    ) as Snapshot["principal"];
  const principal = manualPair("principal");
  const unclaimed = manualPair("unclaimed");
  const manual = [...principal, ...unclaimed].some(
    (value, i) =>
      value !== null &&
      [
        ...(snapshot?.principal ?? [null, null]),
        ...(snapshot?.unclaimed ?? [null, null]),
      ][i] === null,
  );
  if (!snapshot && !manual) return undefined;
  const source = manual
    ? field(fields, `${prefix}snapshotSource`)
    : snapshot?.source;
  requireFact(
    source,
    "Provide a source for manually supplied snapshot quantities.",
  );
  return snapshotSchema.parse({
    ...snapshot,
    principal,
    unclaimed,
    source,
    range: snapshot?.range ?? "UNKNOWN",
  });
}

function resolvedGas(raw: string | null, fields: Fields, prefix: string) {
  if (raw && raw !== "0") return formatUnits(BigInt(raw), 18);
  const explicit = field(fields, `${prefix}gasAmount`);
  if (explicit)
    requireFact(
      quantity.safeParse(explicit).success &&
        new D(explicit).gt(0) &&
        field(fields, `${prefix}gasSource`),
      "Enter the positive total ETH fee and its source.",
    );
  return explicit ?? null;
}

export function walletGroupsFrom(
  cycle: StrategyView,
  watch: WalletWatch,
  rows: WalletActivity[],
  fields: Fields,
  prices: PriceVector[],
): WalletGroup[] {
  requireFact(
    eligibleWalletStrategy(cycle, watch.address),
    "Choose an open Base WETH/cbBTC strategy for this wallet.",
  );
  requireFact(
    field(fields, "confirm") === "yes",
    "Confirm that all selected actions belong to this strategy.",
  );
  const legs = new Map<string, Leg>();
  for (const { definition } of cycle.ledger.legs) {
    if (definition.positionId) legs.set(definition.positionId, definition);
  }
  const reversePair = cycle.market.pair[0].id !== presets.base.pair[0].id;
  const order = <T>(pair: [T, T]): [T, T] =>
    reversePair ? [pair[1], pair[0]] : pair;
  const orientRatio = (ratio?: string) => {
    if (!reversePair || !ratio) return ratio;
    const flipped = new D(1).div(ratio).toDecimalPlaces(36);
    return flipped.gt(0)
      ? priceText.safeParse(flipped.toFixed()).data
      : undefined;
  };
  return rows.map((row, rowIndex) => {
    const draft = pancakeDraftSchema.parse(row.draft);
    const evidence = evidenceSchema.parse(row.evidence);
    requireFact(
      evidence.from === watch.address &&
        row.occurredAt &&
        row.blockNumber !== null &&
        row.blockHash &&
        row.txIndex !== null,
      "This transaction no longer has enough verified wallet evidence.",
    );
    const at = row.occurredAt.toISOString();
    const withGas = resolvedGas(evidence.fees.total, fields, `r${rowIndex}`);
    const gasFunding: GasFunding | undefined = withGas
      ? funding.parse(field(fields, `r${rowIndex}funding`))
      : undefined;
    const facts = draft.actions.map((op, actionIndex) => {
      const prefix = swapField(rowIndex, actionIndex);
      const gas = withGas
        ? actionIndex === 0
          ? "RECORDED"
          : "SHARED"
        : "UNKNOWN";
      const cost: EventFacts["costs"] =
        withGas && gasFunding && actionIndex === 0
          ? [
              {
                asset: cycle.market.native.id,
                amount: withGas,
                funding: gasFunding,
                category: op.kind === "APPROVAL" ? "APPROVAL_GAS" : "GAS",
              },
            ]
          : [];
      const gasSource =
        (!evidence.fees.total || evidence.fees.total === "0") && withGas
          ? field(fields, `r${rowIndex}gasSource`)
          : undefined;
      const base = {
        txHash: row.txHash,
        actionIndex: op.index,
        gas,
        costs: cost,
        notes:
          gasSource && actionIndex === 0
            ? `Manually supplied Base fee: ${gasSource}`
            : undefined,
      };
      if (op.kind === "SWAP") {
        const moves = (pair: [string, string]) =>
          pair.flatMap((amount, i) =>
            amount === "0" ? [] : [{ amount, asset: presets.base.pair[i].id }],
          );
        return eventSchema.parse({
          ...base,
          kind: "SWAP",
          purpose: purpose.parse(field(fields, `${prefix}purpose`)),
          inputs: moves(op.paid),
          outputs: moves(op.received),
        });
      }
      if (op.kind !== "ADD" && op.kind !== "COLLECTION") {
        requireFact(
          withGas,
          "A fee-only transaction needs an actual fee before posting.",
        );
        return eventSchema.parse({ ...base, kind: op.kind });
      }
      let leg = legs.get(op.tokenId);
      let newLeg: Leg | undefined;
      if (op.kind === "ADD" && op.mint) {
        requireFact(!leg, "This position NFT is already linked to a leg.");
        const lower = orientRatio(reversePair ? op.upper : op.lower);
        const upper = orientRatio(reversePair ? op.lower : op.upper);
        const range =
          lower && upper && new D(lower).lt(upper) ? { lower, upper } : {};
        newLeg = leg = {
          id: `pcv3:${op.tokenId}`,
          ...range,
          protocol: importedProtocol,
          pool: op.pool,
          positionId: op.tokenId,
          feeTier: `${new D(op.fee).div(10000).toFixed()}%`,
          feeAttribution: "TRACKED",
        };
        legs.set(op.tokenId, leg);
      }
      requireFact(
        leg &&
          leg.pool?.toLowerCase() === op.pool &&
          /^pancakeswap\s*v3$/i.test(leg.protocol.trim()),
        "Link this PancakeSwap v3 pool and numeric NFT ID to the active leg before importing this transaction.",
      );
      const observed = readSnapshot(op, prefix, fields);
      const snapshot = observed && {
        ...observed,
        principal: order(observed.principal),
        unclaimed: order(observed.unclaimed),
        ratio: orientRatio(observed.ratio),
      };
      const lp = { ...base, snapshot, legId: leg.id };
      if (op.kind === "ADD")
        return eventSchema.parse({
          ...lp,
          kind: "ADD_LIQUIDITY",
          amounts: order(op.amounts),
          newLeg,
        });
      const principal =
        op.principal ??
        knownPair.parse([
          field(fields, `${prefix}split0`),
          field(fields, `${prefix}split1`),
        ]);
      const splitSource = op.principal
        ? undefined
        : field(fields, `${prefix}splitSource`);
      requireFact(
        op.principal || splitSource,
        "Provide the source for the principal/fee split.",
      );
      const fees = principal.map((n, i) => {
        const amount = new D(n);
        requireFact(
          amount.lte(op.receipt[i]),
          "Principal paid cannot exceed what reached the wallet.",
        );
        return new D(op.receipt[i]).minus(amount).toFixed();
      }) as [string, string];
      const note =
        [
          base.notes,
          splitSource && `Manually supplied principal split: ${splitSource}`,
        ]
          .filter(Boolean)
          .join(". ") || undefined;
      return eventSchema.parse(
        principal.every((n) => new D(n).isZero())
          ? { ...lp, notes: note, kind: "COLLECT_FEES", fees: order(fees) }
          : {
              ...lp,
              notes: note,
              kind: "REMOVE_LIQUIDITY",
              principal: order(principal),
              fees: order(fees),
              receipt: order(op.receipt),
            },
      );
    });
    return {
      at,
      revision: row.revision,
      facts,
      prices: prices[rowIndex],
      origin: {
        activityId: row.id,
        blockNumber: row.blockNumber.toString(),
        blockHash: row.blockHash,
        txIndex: row.txIndex,
        sources: row.sources,
        decoderVersion: draft.version,
      },
    };
  });
}

export function verifyWalletReview(db: PrismaClient, rpc: BaseReader) {
  let finalized: Promise<bigint> | undefined;
  const canonicalBlocks = new Map<bigint, ReturnType<BaseReader["block"]>>();
  return async (
    group: WalletGroup,
    { ownerId, address }: { ownerId: string; address: string },
  ) => {
    finalized ??= rpc
      .assertChain()
      .then(() => rpc.block("finalized"))
      .then((block) => block.number);
    const number = BigInt(group.origin.blockNumber);
    const head = await finalized;
    requireFact(
      number <= head,
      "At least one selected transaction has not reached Base finality.",
    );
    const block = canonicalBlocks.get(number) ?? rpc.block(number);
    canonicalBlocks.set(number, block);
    const [receipt, canonical] = await Promise.all([
      rpc.receipt(group.facts[0].txHash!),
      block,
    ]);
    const reverted = group.facts[0].kind === "GAS_ONLY";
    if (
      receipt?.blockHash === canonical.hash &&
      canonical.hash === group.origin.blockHash &&
      canonical.number === number &&
      receipt.transactionIndex === group.origin.txIndex &&
      receipt.blockNumber === number &&
      receipt.transactionHash === group.facts[0].txHash &&
      receipt.from === address &&
      receipt.status === (reverted ? "0x0" : "0x1")
    )
      return;
    await db.walletActivity.updateMany({
      where: {
        ...walletScope(ownerId, address),
        id: group.origin.activityId,
        revision: group.revision,
        status: { in: ["READY", "NEEDS_REVIEW"] },
      },
      data: {
        status: "DETECTED",
        retryAt: null,
        revision: { increment: 1 },
        blockNumber: null,
        blockHash: null,
        txIndex: null,
        occurredAt: null,
        evidence: Prisma.DbNull,
        draft: Prisma.DbNull,
        topLevel: false,
        hasTokens: false,
        hasNfts: false,
      },
    });
    throw new AccountingError(
      "Base evidence changed. Sync and preview the batch again.",
    );
  };
}
