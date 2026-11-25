import { type EventResult, type Ledger } from "./ledger";
import { type Amounts, type Market, type PriceVector } from "./model";
import {
  add,
  D,
  divide,
  MARK_STALE_MS,
  POSITION_STALE_MS,
  QUOTE_NEAR_MS,
  requireFact,
  subtract,
  tokenPrice,
  validateVector,
  value,
} from "./values";

export const CALCULATION_VERSION = "lpstacks-v1";
export type DataNotice = {
  kind: "INCOMPLETE" | "STALE" | "APPROXIMATE" | "BASELINE";
  message: string;
};

export function evaluate(
  market: Market,
  ledger: Ledger,
  at: string,
  prices: PriceVector,
  checkedAt = at,
) {
  requireFact(
    ledger.results.at(-1)!.entry.at <= at,
    "An evaluation cannot contain later journal events.",
  );
  requireFact(
    !ledger.closedAt || ledger.closedAt === at,
    "A final evaluation must use the closure timestamp.",
  );
  validateVector(market, at, prices);
  const notices: DataNotice[] = [];
  const notify = (kind: DataNotice["kind"], message: string) =>
    notices.push({ kind, message });
  const position = ledger.activeLeg?.position;
  const principal: Amounts<string | null> = {};
  const unclaimed: Amounts<string | null> = {};
  const pendingEarned: Amounts<string | null> = {};
  for (const [i, token] of market.pair.entries()) {
    principal[token.id] = ledger.activeLeg
      ? (position?.principal[i] ?? null)
      : "0";
    const outstanding = ledger.activeLeg
      ? (position?.unclaimed[i] ?? null)
      : "0";
    unclaimed[token.id] = outstanding;
    const newFees = subtract(outstanding, ledger.carry[token.id] ?? "0");
    pendingEarned[token.id] =
      newFees === null || new D(newFees).lt(0) ? null : newFees;
  }

  const walletUsd = value(ledger.wallet, prices);
  const principalUsd = value(principal, prices);
  const unclaimedUsd = value(unclaimed, prices);
  const grossWealth = add(add(walletUsd, principalUsd), unclaimedUsd);
  const externalMark = ledger.gasUnknown
    ? null
    : value(ledger.external, prices);
  const netWealth = subtract(grossWealth, externalMark);
  const hodl = value(ledger.initial, prices);
  const openingCapital = value(ledger.initial, ledger.opening.prices);
  const totalPnl = subtract(netWealth, openingCapital);
  const outperformance = subtract(netWealth, hodl);

  const total = (selector: (line: EventResult) => string | null) =>
    ledger.results.reduce<string | null>(
      (previous, line) => add(previous, selector(line)),
      "0",
    );
  const executionShortfall = total((line) =>
    line.swap ? line.swap.shortfall : "0",
  );
  const networkHistorical = total((line) => line.networkHistorical);
  const otherHistorical = total((line) => line.otherHistorical);
  const externalHistorical = ledger.gasUnknown
    ? null
    : total((line) => line.externalHistorical);
  const explicitCosts = add(networkHistorical, otherHistorical);
  const operationalCosts = add(executionShortfall, explicitCosts);
  const attributionKnown = ledger.legs.every(
    (leg) => leg.definition.feeAttribution === "TRACKED",
  );
  const claimedHistorical = attributionKnown
    ? total((line) => line.claimedHistorical)
    : null;
  const claimedMarked = attributionKnown
    ? value(ledger.earnedClaimed, prices)
    : null;
  const pendingMarked = attributionKnown ? value(pendingEarned, prices) : null;
  const netClaimedIncome = subtract(claimedHistorical, operationalCosts);
  const eligibleLeg = ledger.activeLeg;
  const divergence =
    eligibleLeg?.deposits === 1 &&
    eligibleLeg.withdrawals === 0 &&
    eligibleLeg.definition.feeAttribution === "TRACKED" &&
    eligibleLeg.originalDeposit
      ? subtract(principalUsd, value(eligibleLeg.originalDeposit, prices))
      : null;

  if (ledger.openingFacts.baseline === "POST_ENTRY_ONLY") {
    notify(
      "BASELINE",
      "Post-entry comparison; costs and performance before the opening snapshot are excluded.",
    );
  } else if (ledger.openingFacts.baseline === "ESTIMATED") {
    notify(
      "BASELINE",
      "The opening allocation is estimated. Performance is relative to that estimate.",
    );
  }
  if (ledger.gasUnknown)
    notify(
      "INCOMPLETE",
      "Unknown network fees: recorded wallet balances may omit a debit.",
    );
  if (Object.values(principal).includes(null))
    notify(
      "INCOMPLETE",
      "LP principal is unknown until a complete position snapshot is recorded.",
    );
  if (Object.values(unclaimed).includes(null))
    notify("INCOMPLETE", "Outstanding fees are not fully known.");
  if (!attributionKnown)
    notify(
      "INCOMPLETE",
      "LP fee attribution is unavailable for at least one leg.",
    );
  if (
    Object.values(pendingEarned).includes(null) &&
    !Object.values(unclaimed).includes(null)
  ) {
    notify(
      "INCOMPLETE",
      "Outstanding fees no longer reconcile with the imported opening fee balance.",
    );
  }
  if (
    !ledger.closedAt &&
    Date.parse(checkedAt) - Date.parse(at) > MARK_STALE_MS
  ) {
    notify("STALE", "The saved evaluation mark is over one hour old.");
  }
  if (
    position &&
    Date.parse(checkedAt) - Date.parse(position.at) > POSITION_STALE_MS
  ) {
    notify(
      "STALE",
      "Estimated with LP composition last observed over 24 hours ago.",
    );
  }
  if (ledger.results.some((line) => line.swap?.mismatched)) {
    notify(
      "INCOMPLETE",
      "At least one swap lacks compatible reference observations within two hours of each other.",
    );
  }
  if (
    netWealth === null ||
    openingCapital === null ||
    hodl === null ||
    operationalCosts === null ||
    claimedHistorical === null
  ) {
    notify(
      "INCOMPLETE",
      "Unresolved prices or quantities block one or more metrics. N/A is not zero.",
    );
  }
  if (prices.some((quote) => quote.quality === "PROXY"))
    notify("APPROXIMATE", "The mark uses at least one disclosed proxy price.");
  if (
    prices.some(
      (quote) =>
        quote.quality === "APPROXIMATE" ||
        (quote.observedAt &&
          Math.abs(Date.parse(at) - Date.parse(quote.observedAt)) >
            QUOTE_NEAR_MS),
    )
  ) {
    notify(
      "APPROXIMATE",
      "At least one mark observation is more than 15 minutes from the evaluation time or is coarse.",
    );
  }
  if (
    !ledger.closedAt &&
    prices.some(
      (quote) =>
        quote.observedAt &&
        Date.parse(at) - Date.parse(quote.observedAt) > MARK_STALE_MS &&
        [
          ledger.initial,
          ledger.wallet,
          ledger.external,
          principal,
          unclaimed,
        ].some(
          (amounts) =>
            amounts[quote.asset] != null && new D(amounts[quote.asset]!).gt(0),
        ),
    )
  ) {
    notify(
      "STALE",
      "A reference price used for the strategy or benchmark was observed over one hour before the evaluation.",
    );
  }

  const equivalents = Object.fromEntries(
    market.pair.map((token) => {
      const spot = tokenPrice(token.id, prices);
      return [
        token.id,
        {
          opening: divide(
            openingCapital,
            tokenPrice(token.id, ledger.opening.prices),
          ),
          netWealth: divide(netWealth, spot),
          hodl: divide(hodl, spot),
          outperformance: divide(outperformance, spot),
          wealthChange: subtract(
            divide(netWealth, spot),
            divide(openingCapital, tokenPrice(token.id, ledger.opening.prices)),
          ),
        },
      ];
    }),
  );
  const [first, second] = market.pair.map((token) =>
    tokenPrice(token.id, prices),
  );

  return {
    at,
    version: CALCULATION_VERSION,
    baseline: ledger.openingFacts.baseline,
    notices,
    quantities: {
      opening: ledger.initial,
      wallet: ledger.wallet,
      principal,
      unclaimed,
      external: ledger.external,
      claimed: ledger.claimed,
      earnedClaimed: ledger.earnedClaimed,
      earnedPending: pendingEarned,
    },
    openingCapital,
    walletUsd,
    principalUsd,
    unclaimedUsd,
    grossWealth,
    externalMark,
    netWealth,
    hodl,
    totalPnl,
    outperformance,
    totalReturn: divide(totalPnl, openingCapital, 100),
    relativePerformance: divide(outperformance, hodl, 100),
    hodlPnl: subtract(hodl, openingCapital),
    cashBasisNet: subtract(grossWealth, externalHistorical),
    equivalents,
    crossRates: {
      token1PerToken0: divide(first, second),
      token0PerToken1: divide(second, first),
    },
    executionShortfall,
    networkHistorical,
    otherHistorical,
    explicitCosts,
    operationalCosts,
    externalHistorical,
    claimedHistorical,
    claimedMarked,
    pendingMarked,
    grossMarked: add(claimedMarked, pendingMarked),
    netClaimedIncome,
    netIncomeWithPending: add(netClaimedIncome, pendingMarked),
    divergence,
  };
}

export type Evaluation = ReturnType<typeof evaluate>;
