import { z } from "zod";
import { presets, mappings } from "@/domain/catalog";
import {
  address,
  eventSchema,
  type Entry,
  type EventFacts,
  type Leg,
  marketSchema,
  type Market,
  type Snapshot,
  tokens,
} from "@/domain/model";
import { requireFact } from "@/domain/values";
import { fromLocal, localInput } from "@/lib/time";
import { metadataSchema } from "./journal";
import { choiceSchema, type PriceChoice } from "./pricing";

export type Fields = Record<string, string>;
export const field = (fields: Fields, name: string) =>
  fields[name]?.trim() || undefined;
export const command = (fields: Fields) =>
  z.uuid().parse(field(fields, "command"));
export const required = (fields: Fields, name: string, label: string) => {
  const value = field(fields, name);
  requireFact(value, `Enter ${label}.`);
  return value;
};
export function fieldsFrom(form: FormData) {
  return Object.fromEntries(
    [...form.entries()].filter(
      ([key, value]) =>
        /^[a-z][a-zA-Z0-9_]{0,79}$/.test(key) && typeof value === "string",
    ),
  ) as Fields;
}

const integer = (v: string | undefined) =>
  v && /^\d{1,10}$/.test(v) ? Number(v) : undefined;
const explicit = (f: Fields, name: string) => field(f, name) ?? "0";
const tuple = (f: Fields, stem: string): [string, string] => [
  explicit(f, `${stem}0`),
  explicit(f, `${stem}1`),
];

export function marketFrom(f: Fields): Market {
  const mode = f.preset;
  if (mode === "base" || mode === "ethereum")
    return marketSchema.parse(presets[mode]);
  requireFact(
    mode === "custom",
    "Select the actual strategy network and pair.",
  );
  const chainId = required(f, "chainId", "a chain ID");
  const native = {
    id: `${chainId}:native`,
    symbol: f.nativeSymbol,
    decimals: integer(f.nativeDecimals),
  };
  const normal = (i: number) => {
    const value = required(
      f,
      `address${i}`,
      `the token${i} address or native identifier`,
    );
    if (value.toLowerCase() === "native") return native;
    return {
      id: `${chainId}:${address.parse(value)}`,
      symbol: f[`symbol${i}`],
      decimals: integer(f[`decimals${i}`]),
      wrapsNative: f[`wrapped${i}`] === "true",
    };
  };
  return marketSchema.parse({
    chainId,
    network: f.network,
    native,
    pair: [normal(0), normal(1)],
  });
}

export function metadataFrom(f: Fields) {
  return metadataSchema.parse({
    name: field(f, "name"),
    protocol: field(f, "protocol"),
    notes: field(f, "strategyNotes"),
    walletAddress: field(f, "walletAddress"),
    positionRef: field(f, "positionRef"),
  });
}

function legFrom(f: Fields, id: string, protocol: string) {
  return {
    id,
    protocol: field(f, "legProtocol") ?? protocol,
    pool: field(f, "pool"),
    positionId: field(f, "positionId"),
    feeTier: field(f, "feeTier"),
    feeAttribution: field(f, "feeAttribution") ?? "TRACKED",
    lower: field(f, "lower"),
    upper: field(f, "upper"),
  };
}

function snapshotFrom(f: Fields) {
  return {
    principal: [field(f, "principal0") ?? null, field(f, "principal1") ?? null],
    unclaimed: [field(f, "pending0") ?? null, field(f, "pending1") ?? null],
    source: required(f, "snapshotSource", "a position snapshot source"),
    range: field(f, "range") ?? "UNKNOWN",
    ratio: field(f, "ratio"),
    liquidity: field(f, "liquidity"),
  };
}

export function factsFrom(
  f: Fields,
  market: Market,
  protocol: string,
  stableId: string,
): EventFacts {
  const kind = f.kind;
  const noExpense = [
    "OPENING_ALLOCATION",
    "POSITION_SNAPSHOT",
    "CLOSE_STRATEGY",
  ].includes(kind);
  const gas = noExpense ? "NONE" : required(f, "gas", "network fee coverage");
  const network =
    gas === "RECORDED"
      ? [
          {
            asset: f.gasAsset,
            amount: required(f, "gasAmount", "the total network fee"),
            funding: f.gasFunding,
            category: kind === "APPROVAL" ? "APPROVAL_GAS" : "GAS",
          },
        ]
      : [];
  const extras = noExpense
    ? []
    : Array.from({ length: 4 }, (_, i) => ({
        asset: field(f, `costAsset${i}`),
        amount: field(f, `costAmount${i}`),
        funding: field(f, `costFunding${i}`),
        category: field(f, `costCategory${i}`),
      })).filter((cost) => cost.amount !== undefined);
  const common = {
    kind,
    gas,
    costs: [...network, ...extras],
    notes: field(f, "notes"),
    txHash: noExpense ? undefined : field(f, "txHash"),
    actionIndex: noExpense ? undefined : integer(field(f, "actionIndex")),
    group: noExpense ? undefined : field(f, "group"),
  };
  if (!noExpense && field(f, "actionIndex") !== undefined)
    requireFact(
      common.actionIndex !== undefined,
      "Use a nonnegative integer action index.",
    );
  const moves = (direction: "in" | "out") =>
    Array.from({ length: 4 }, (_, i) => ({
      asset: field(f, `${direction}Asset${i}`),
      amount: field(f, `${direction}Amount${i}`),
    })).filter((move) => move.amount !== undefined);
  const snapshot = () =>
    f.observe === "record" || kind === "POSITION_SNAPSHOT"
      ? snapshotFrom(f)
      : undefined;
  switch (kind) {
    case "OPENING_ALLOCATION":
      return eventSchema.parse({
        ...common,
        baseline: f.baseline,
        wallet: Object.fromEntries(
          tokens(market).map((token, i) => [
            token.id,
            explicit(f, `wallet${i}`),
          ]),
        ),
        imported:
          f.importPosition === "yes"
            ? { leg: legFrom(f, stableId, protocol), snapshot: snapshotFrom(f) }
            : undefined,
      });
    case "SWAP":
      return eventSchema.parse({
        ...common,
        purpose: f.purpose,
        inputs: moves("in"),
        outputs: moves("out"),
      });
    case "WRAP_UNWRAP":
      return eventSchema.parse({
        ...common,
        input: moves("in")[0],
        output: moves("out")[0],
      });
    case "ADD_LIQUIDITY":
      return eventSchema.parse({
        ...common,
        legId: f.legId === "new" ? stableId : f.legId,
        amounts: tuple(f, "deposit"),
        newLeg: f.legId === "new" ? legFrom(f, stableId, protocol) : undefined,
        snapshot: snapshot(),
      });
    case "REMOVE_LIQUIDITY":
      return eventSchema.parse({
        ...common,
        legId: f.legId,
        principal: tuple(f, "withdraw"),
        fees: tuple(f, "fee"),
        receipt: tuple(f, "receipt"),
        snapshot: snapshot(),
      });
    case "COLLECT_FEES":
      return eventSchema.parse({
        ...common,
        legId: f.legId,
        fees: tuple(f, "fee"),
        snapshot: snapshot(),
      });
    case "POSITION_SNAPSHOT":
      return eventSchema.parse({
        ...common,
        legId: f.legId,
        snapshot: snapshot(),
      });
    default:
      return eventSchema.parse(common);
  }
}

export function priceChoices(f: Fields, market: Market, zone: string) {
  const kept: string[] = [];
  const choices: Record<string, PriceChoice> = {};
  tokens(market).forEach((token, i) => {
    const mode = f[`p${i}Mode`] ?? (mappings[token.id] ? "AUTO" : "MISSING");
    if (mode === "KEEP") {
      kept.push(token.id);
      choices[token.id] = { mode: "MISSING" };
      return;
    }
    const observed = field(f, `p${i}Observed`);
    choices[token.id] = choiceSchema.parse({
      mode,
      usd: field(f, `p${i}Usd`),
      source: field(f, "priceSource"),
      reason: field(f, "priceReason"),
      observedAt:
        mode === "MANUAL" && observed ? fromLocal(observed, zone) : undefined,
    });
  });
  return { choices, kept };
}

export function editFields(entry: Entry, market: Market, zone: string): Fields {
  const f: Fields = { kind: entry.facts.kind, at: localInput(entry.at, zone) };
  const data = entry.facts;
  f.gas = data.gas;
  f.txHash = data.txHash ?? "";
  f.actionIndex = data.actionIndex?.toString() ?? "";
  f.notes = data.notes ?? "";
  f.group = data.group ?? "";
  let expense = 0;
  for (const c of data.costs) {
    if (c.category === "GAS" || c.category === "APPROVAL_GAS") {
      Object.assign(f, {
        gasAsset: c.asset,
        gasAmount: c.amount,
        gasFunding: c.funding,
      });
    } else {
      Object.assign(f, {
        [`costAsset${expense}`]: c.asset,
        [`costAmount${expense}`]: c.amount,
        [`costFunding${expense}`]: c.funding,
        [`costCategory${expense}`]: c.category,
      });
      expense++;
    }
  }
  f.costRows = String(Math.max(1, expense));
  const tupleTo = (stem: string, values: [string | null, string | null]) => {
    f[`${stem}0`] = values[0] ?? "";
    f[`${stem}1`] = values[1] ?? "";
  };
  const snapshotTo = (s: Snapshot | undefined) => {
    f.observe = s ? "record" : "omit";
    if (!s) return;
    tupleTo("principal", s.principal);
    tupleTo("pending", s.unclaimed);
    Object.assign(f, {
      snapshotSource: s.source,
      range: s.range,
      ratio: s.ratio ?? "",
      liquidity: s.liquidity ?? "",
    });
  };
  const legTo = (l: Leg) =>
    Object.assign(f, {
      legProtocol: l.protocol,
      pool: l.pool ?? "",
      positionId: l.positionId ?? "",
      feeTier: l.feeTier ?? "",
      feeAttribution: l.feeAttribution,
      lower: l.lower ?? "",
      upper: l.upper ?? "",
    });
  if (data.kind === "OPENING_ALLOCATION") {
    f.baseline = data.baseline;
    tokens(market).forEach((t, i) => {
      f[`wallet${i}`] = data.wallet[t.id] ?? "0";
    });
    if (data.imported) {
      f.importPosition = "yes";
      legTo(data.imported.leg);
      snapshotTo(data.imported.snapshot);
    }
  }
  if (data.kind === "SWAP" || data.kind === "WRAP_UNWRAP") {
    if (data.kind === "SWAP") f.purpose = data.purpose;
    for (const [dir, list] of [
      ["in", data.kind === "SWAP" ? data.inputs : [data.input]],
      ["out", data.kind === "SWAP" ? data.outputs : [data.output]],
    ] as const) {
      f[`${dir}Rows`] = String(list.length);
      list.forEach((m, i) => {
        f[`${dir}Asset${i}`] = m.asset;
        f[`${dir}Amount${i}`] = m.amount;
      });
    }
  }
  if ("legId" in data) {
    f.legId = data.legId;
    snapshotTo(data.snapshot);
    if (data.kind === "ADD_LIQUIDITY") {
      tupleTo("deposit", data.amounts);
      if (data.newLeg) {
        f.legId = "new";
        legTo(data.newLeg);
      }
    }
    if (data.kind === "REMOVE_LIQUIDITY") {
      tupleTo("withdraw", data.principal);
      tupleTo("receipt", data.receipt);
    }
    if (data.kind === "COLLECT_FEES" || data.kind === "REMOVE_LIQUIDITY")
      tupleTo("fee", data.fees);
  }
  tokens(market).forEach((_, i) => {
    f[`p${i}Mode`] = "KEEP";
  });
  return f;
}
