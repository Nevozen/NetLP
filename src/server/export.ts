import { isGas, tokens } from "@/domain/model";
import { tokenPrice, value } from "@/domain/values";
import type { StrategyView } from "./journal";

type Cell = string | null | undefined | { decimal: string };
const numeric = (value: string | null | undefined): Cell =>
  value == null ? null : { decimal: value };

export function csvCell(value: Cell) {
  if (value == null) return '""';
  const text = typeof value === "string" ? value : value.decimal;
  const computed = typeof value !== "string" && /^-?\d+(\.\d+)?$/.test(text);
  const dangerous =
    /^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@]/u.test(text) ||
    /^[\t\r\n]/.test(text);
  return `"${(dangerous && !computed ? `'${text}` : text).replaceAll('"', '""')}"`;
}

export function strategyCsv(cycle: StrategyView) {
  const rows: Cell[][] = [
    [
      "record",
      "cycle",
      "event id",
      "UTC timestamp",
      "classification",
      "asset identity",
      "native quantity",
      "USD value",
      "valuation basis",
      "coverage / source",
      "reference / notes",
    ],
  ];
  const row = (
    type: string,
    id: string | undefined,
    at: string,
    name: string,
    asset?: string,
    qty?: string | null,
    usd?: string | null,
    basis?: string,
    quality?: string,
    notes?: string,
  ) => {
    rows.push([
      type,
      cycle.name,
      id,
      at,
      name,
      asset,
      numeric(qty),
      numeric(usd),
      basis,
      quality,
      notes,
    ]);
  };
  row(
    "strategy",
    undefined,
    cycle.openedAt.toISOString(),
    cycle.protocol,
    undefined,
    undefined,
    undefined,
    cycle.market.network,
    cycle.evaluation.baseline,
    cycle.notes ?? undefined,
  );
  const symbol = (id: string) =>
    tokens(cycle.market).find((t) => t.id === id)?.symbol ?? id;
  for (const { entry, walletDelta, earned, received, swap } of cycle.ledger
    .results) {
    const { id, at, facts, prices } = entry;
    const version = cycle.events.find((e) => e.entry.id === id)!.version;
    row(
      "event",
      id,
      at,
      facts.kind,
      undefined,
      undefined,
      swap?.shortfall,
      swap ? "Event-time execution shortfall" : undefined,
      `Revision ${version}; gas ${facts.gas}`,
      [facts.txHash, facts.actionIndex?.toString(), facts.group, facts.notes]
        .filter(Boolean)
        .join(" | "),
    );
    const raw = (leg: string, asset: string, amount: string) =>
      row(
        "movement",
        id,
        at,
        leg,
        asset,
        amount,
        value({ [asset]: amount }, prices),
        "Actual quantities / event-time USD",
        symbol(asset),
      );
    if (facts.kind === "SWAP") {
      for (const move of facts.inputs)
        raw("SWAP_SENT", move.asset, move.amount);
      for (const move of facts.outputs)
        raw("SWAP_RECEIVED", move.asset, move.amount);
    }
    if (facts.kind === "WRAP_UNWRAP") {
      raw("WRAP_SENT", facts.input.asset, facts.input.amount);
      raw("WRAP_RECEIVED", facts.output.asset, facts.output.amount);
    }
    const pairMoves = (type: string, amounts: [string, string]) =>
      cycle.market.pair.forEach((token, i) => raw(type, token.id, amounts[i]));
    if (facts.kind === "ADD_LIQUIDITY")
      pairMoves("DEPOSIT_PRINCIPAL", facts.amounts);
    if (facts.kind === "REMOVE_LIQUIDITY")
      pairMoves("WITHDRAW_PRINCIPAL", facts.principal);
    for (const [asset, amount] of Object.entries(walletDelta)) {
      row(
        "wallet_delta",
        id,
        at,
        "ACTUAL_NET_DEBIT_OR_CREDIT",
        asset,
        amount,
        value({ [asset]: amount }, prices),
        "Event-time USD",
        symbol(asset),
      );
    }
    for (const cost of facts.costs) {
      row(
        "expense",
        id,
        at,
        cost.category,
        cost.asset,
        cost.amount,
        value({ [cost.asset]: cost.amount }, prices),
        "Event-time USD",
        cost.funding,
        isGas(cost)
          ? "Total network fee; do not include components again"
          : undefined,
      );
    }
    for (const [asset, amount] of Object.entries(received)) {
      row(
        "fee_receipt",
        id,
        at,
        "TOTAL_CLAIMED",
        asset,
        amount,
        value({ [asset]: amount }, prices),
        "Claim-time USD",
      );
      const legId = "legId" in facts ? facts.legId : undefined;
      const attributed =
        cycle.ledger.legs.find((leg) => leg.definition.id === legId)?.definition
          .feeAttribution === "TRACKED";
      row(
        "fee_receipt",
        id,
        at,
        "EARNED_SINCE_BASELINE",
        asset,
        attributed ? earned[asset] : null,
        attributed ? value({ [asset]: earned[asset] }, prices) : null,
        "Claim-time USD",
        attributed ? undefined : "ATTRIBUTION_UNAVAILABLE",
      );
    }
    for (const quote of prices) {
      row(
        "price",
        id,
        at,
        "REFERENCE_PRICE",
        quote.asset,
        undefined,
        quote.usd,
        quote.resolution,
        `${quote.source} | ${quote.quality}`,
        [quote.observedAt, quote.providerAsset, quote.note]
          .filter(Boolean)
          .join(" | "),
      );
    }
    const snapshot =
      facts.kind === "OPENING_ALLOCATION"
        ? facts.imported?.snapshot
        : "snapshot" in facts
          ? facts.snapshot
          : undefined;
    if (snapshot)
      cycle.market.pair.forEach((token, i) => {
        row(
          "snapshot",
          id,
          at,
          "LP_PRINCIPAL",
          token.id,
          snapshot.principal[i],
          value({ [token.id]: snapshot.principal[i] }, prices),
          "Observed, excludes fees",
          snapshot.source,
          snapshot.range,
        );
        row(
          "snapshot",
          id,
          at,
          "UNCLAIMED",
          token.id,
          snapshot.unclaimed[i],
          value({ [token.id]: snapshot.unclaimed[i] }, prices),
          "Observed, separate from principal",
          snapshot.source,
        );
      });
  }
  const e = cycle.evaluation;
  for (const quote of cycle.mark.prices)
    row(
      "price",
      undefined,
      e.at,
      "EVALUATION",
      quote.asset,
      undefined,
      tokenPrice(quote.asset, cycle.mark.prices),
      quote.resolution,
      `${quote.source} | ${quote.quality}`,
      quote.note,
    );
  const metrics = [
    ["OPENING_CAPITAL", e.openingCapital, "Opening mark"],
    ["NET_WEALTH", e.netWealth, "Evaluation mark"],
    ["HODL", e.hodl, "Evaluation mark on original allocation"],
    ["TOTAL_PNL", e.totalPnl, "Net wealth minus opening capital"],
    ["OUTPERFORMANCE", e.outperformance, "Net wealth minus HODL"],
    ["GROSS_FEES", e.grossMarked, "Evaluation mark"],
    [
      "NET_FEE_INCOME",
      e.netIncomeWithPending,
      "Mixed historical costs and evaluation-time pending fees",
    ],
    ["EXTERNAL_COST_MARK", e.externalMark, "Evaluation-time opportunity cost"],
  ] as const;
  metrics.forEach(([key, usd, basis]) =>
    row(
      "performance",
      undefined,
      e.at,
      key,
      undefined,
      undefined,
      usd,
      basis,
      usd === null ? "INCOMPLETE" : cycle.closedAt ? "FROZEN" : "OPEN",
      e.version,
    ),
  );
  for (const notice of e.notices)
    row(
      "coverage",
      undefined,
      e.at,
      notice.kind,
      undefined,
      undefined,
      undefined,
      undefined,
      notice.message,
    );
  return `${rows.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
