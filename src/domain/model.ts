import { z } from "zod";

export const USD_CASH = "usd:cash";
export const assetId = z
  .string()
  .regex(/^(?:[1-9]\d{0,14}:(?:native|0x[a-f0-9]{40})|usd:cash)$/);
export const timestamp = z.iso.datetime({ precision: 3 });
export const quantity = z
  .string()
  .regex(
    /^\d{1,24}(?:\.\d{1,24})?$/,
    "Use a nonnegative decimal with at most 24 digits on each side of the point.",
  );
export const priceText = z
  .string()
  .regex(
    /^\d{1,24}(?:\.\d{1,36})?$/,
    "Use a decimal price with at most 36 fractional digits.",
  );
export const knownPair = z.tuple([quantity, quantity]);
const observedPair = z.tuple([quantity.nullable(), quantity.nullable()]);
const ident = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const label = z.string().trim().min(1).max(120);
export const note = z.string().trim().max(2000);
export const address = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^0x[a-f0-9]{40}$/);
export const hash = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^0x[a-f0-9]{64}$/);
export const baseline = z.enum([
  "PRE_ENTRY_VERIFIED",
  "POST_ENTRY_ONLY",
  "ESTIMATED",
]);

export const tokenSchema = z.object({
  id: assetId,
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[a-zA-Z0-9._-]+$/),
  decimals: z.number().int().min(0).max(24),
  wrapsNative: z.boolean().optional(),
});

export const marketSchema = z
  .object({
    chainId: z.string().regex(/^[1-9]\d{0,14}$/),
    network: label,
    pair: z.tuple([tokenSchema, tokenSchema]),
    native: tokenSchema,
  })
  .superRefine(({ chainId, pair, native }, ctx) => {
    if (native.id !== `${chainId}:native` || native.wrapsNative) {
      ctx.addIssue({
        code: "custom",
        message: "The native asset must match this network.",
      });
    }
    if (
      pair[0].id === pair[1].id ||
      pair.some((token) => !token.id.startsWith(`${chainId}:`))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Choose two distinct assets identified on the selected network.",
      });
    }
    if (
      pair.some(
        (token) =>
          token.id === native.id &&
          (token.decimals !== native.decimals ||
            token.symbol !== native.symbol ||
            token.wrapsNative),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A native pair asset must match the configured native asset.",
      });
    }
    if (
      pair.some(
        (token) => token.wrapsNative && token.decimals !== native.decimals,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "A wrapped native asset must use the same precision as the native token.",
      });
    }
  });

export const legSchema = z.object({
  id: ident,
  protocol: label,
  pool: label.optional(),
  positionId: label.optional(),
  feeTier: label.optional(),
  feeAttribution: z.enum(["TRACKED", "UNAVAILABLE"]),
  lower: priceText.optional(),
  upper: priceText.optional(),
});

export const snapshotSchema = z.object({
  principal: observedPair,
  unclaimed: observedPair,
  source: label,
  range: z.enum(["IN_RANGE", "OUT_OF_RANGE", "UNKNOWN"]),
  ratio: priceText.optional(),
  liquidity: quantity.optional(),
});

const movement = z.object({ asset: assetId, amount: quantity });
const cost = movement.extend({
  funding: z.enum(["STRATEGY_WALLET", "EXTERNAL"]),
  category: z.enum([
    "GAS",
    "APPROVAL_GAS",
    "PROTOCOL_FEE",
    "BRIDGE_FEE",
    "OTHER",
  ]),
});
const legEvent = z.object({
  legId: ident,
  snapshot: snapshotSchema.optional(),
});

export const eventSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("OPENING_ALLOCATION"),
      baseline,
      wallet: z.record(assetId, quantity),
      imported: z
        .object({ leg: legSchema, snapshot: snapshotSchema })
        .optional(),
    }),
    z.object({
      kind: z.literal("SWAP"),
      purpose: z.enum(["ENTRY", "EXIT", "REBALANCE", "OTHER"]),
      inputs: z.array(movement).min(1).max(8),
      outputs: z.array(movement).min(1).max(8),
    }),
    z.object({
      kind: z.literal("WRAP_UNWRAP"),
      input: movement,
      output: movement,
    }),
    legEvent.extend({
      kind: z.literal("ADD_LIQUIDITY"),
      amounts: knownPair,
      newLeg: legSchema.optional(),
    }),
    legEvent.extend({
      kind: z.literal("REMOVE_LIQUIDITY"),
      principal: knownPair,
      fees: knownPair,
      receipt: knownPair,
    }),
    legEvent.extend({ kind: z.literal("COLLECT_FEES"), fees: knownPair }),
    legEvent.extend({
      kind: z.literal("POSITION_SNAPSHOT"),
      snapshot: snapshotSchema,
    }),
    z.object({ kind: z.literal("APPROVAL") }),
    z.object({ kind: z.literal("GAS_ONLY") }),
    z.object({ kind: z.literal("OTHER_EXPENSE") }),
    z.object({ kind: z.literal("CLOSE_STRATEGY") }),
  ])
  .and(
    z.object({
      gas: z.enum(["NONE", "RECORDED", "SHARED", "UNKNOWN"]),
      costs: z.array(cost).max(8),
      txHash: hash.optional(),
      actionIndex: z.number().int().min(0).max(2147483647).optional(),
      group: label.optional(),
      notes: note.optional(),
    }),
  );

export const quoteSchema = z.object({
  asset: assetId,
  usd: priceText.nullable(),
  requestedAt: timestamp,
  observedAt: timestamp.nullable(),
  fetchedAt: timestamp,
  source: label,
  providerAsset: label.optional(),
  resolution: label,
  quality: z.enum([
    "EXACT_OR_NEAR",
    "APPROXIMATE",
    "MANUAL",
    "PROXY",
    "MISSING",
  ]),
  note: note.optional(),
});
export const vectorSchema = z.array(quoteSchema).max(4);

export type Market = z.infer<typeof marketSchema>;
export type Token = z.infer<typeof tokenSchema>;
export type Leg = z.infer<typeof legSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type EventFacts = z.infer<typeof eventSchema>;
export type EventKind = EventFacts["kind"];
export type Cost = z.infer<typeof cost>;
export type Movement = z.infer<typeof movement>;
export type Quote = z.infer<typeof quoteSchema>;
export type PriceVector = Quote[];
export type Amounts<T = string> = Record<string, T>;

export const walletOriginSchema = z.object({
  activityId: z.uuid(),
  blockNumber: z.string().regex(/^\d{1,24}$/),
  blockHash: hash,
  txIndex: z.number().int().nonnegative(),
  sources: z
    .array(z.enum(["ALCHEMY", "CSV", "HASH"]))
    .min(1)
    .max(3),
  decoderVersion: z.number().int().positive(),
});
export type WalletOrigin = z.infer<typeof walletOriginSchema>;

export interface Entry {
  id: string;
  at: string;
  sequence: number;
  facts: EventFacts;
  prices: PriceVector;
  walletOrigin?: WalletOrigin;
}

export function tokens(market: Market): Token[] {
  return [
    ...new Map(
      [...market.pair, market.native].map((token) => [token.id, token]),
    ).values(),
  ];
}

export function isGas(cost: Cost) {
  return cost.category === "GAS" || cost.category === "APPROVAL_GAS";
}
