import Decimal from "decimal.js";
import {
  type Amounts,
  type Market,
  type Movement,
  type PriceVector,
  tokens,
  USD_CASH,
} from "./model";

// With bounded decimal inputs, products and ledger sums remain exact at this precision.
export const D = Decimal.clone({
  precision: 120,
  rounding: Decimal.ROUND_HALF_EVEN,
});
export const QUOTE_NEAR_MS = 15 * 60_000;
export const SWAP_MAX_SPREAD_MS = 2 * 60 * 60_000;
export const POSITION_STALE_MS = 24 * 60 * 60_000;
export const MARK_STALE_MS = 60 * 60_000;

export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

export function requireFact(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new AccountingError(message);
}

export function sum(values: Iterable<string>): string {
  let total = new D(0);
  for (const value of values) total = total.plus(value);
  return total.toFixed();
}

export function add(a: string | null, b: string | null): string | null {
  return a === null || b === null ? null : new D(a).plus(b).toFixed();
}

export function subtract(a: string | null, b: string | null): string | null {
  return a === null || b === null ? null : new D(a).minus(b).toFixed();
}

export function divide(
  a: string | null,
  b: string | null,
  scale = 1,
): string | null {
  return a === null || b === null || new D(b).isZero()
    ? null
    : new D(a).times(scale).div(b).toFixed();
}

export function tokenPrice(asset: string, prices: PriceVector): string | null {
  return asset === USD_CASH
    ? "1"
    : (prices.find((quote) => quote.asset === asset)?.usd ?? null);
}

export function value(
  amounts: Amounts<string | null>,
  prices: PriceVector,
): string | null {
  let total = new D(0);
  for (const [asset, amount] of Object.entries(amounts)) {
    if (amount === null) return null;
    if (new D(amount).isZero()) continue;
    const price = tokenPrice(asset, prices);
    if (price === null) return null;
    total = total.plus(new D(amount).times(price));
  }
  return total.toFixed();
}

export function accumulate(
  balances: Amounts,
  asset: string,
  delta: Decimal.Value,
) {
  const updated = new D(balances[asset] ?? "0").plus(delta);
  balances[asset] = updated.toFixed();
  return updated;
}

export function validateVector(
  market: Market,
  at: string,
  prices: PriceVector,
) {
  const allowed = new Set(tokens(market).map((token) => token.id));
  const seen = new Set<string>();
  for (const quote of prices) {
    requireFact(
      allowed.has(quote.asset) && !seen.has(quote.asset),
      "The reference vector must have at most one quote per configured asset.",
    );
    requireFact(
      quote.requestedAt === at,
      "All quotes must reference the event or evaluation timestamp.",
    );
    if (quote.quality === "MISSING") {
      requireFact(
        quote.usd === null && quote.observedAt === null,
        "Missing quotes cannot have a value or market timestamp.",
      );
    } else {
      requireFact(
        quote.usd !== null &&
          new D(quote.usd).gt(0) &&
          quote.observedAt !== null,
        "Reference prices must be positive and include an observation timestamp.",
      );
      if (quote.quality === "MANUAL" || quote.quality === "PROXY") {
        requireFact(
          quote.note,
          "Manual and proxy quotes require a reason or disclosure.",
        );
      }
    }
    seen.add(quote.asset);
  }
}

export function execution(
  input: Movement[],
  output: Movement[],
  prices: PriceVector,
) {
  const mark = (moves: Movement[]) => {
    const amounts: Amounts = {};
    for (const move of moves) accumulate(amounts, move.asset, move.amount);
    return value(amounts, prices);
  };
  const assetIds = new Set([...input, ...output].map((move) => move.asset));
  const observationTimes = prices
    .filter((q) => assetIds.has(q.asset) && q.observedAt)
    .map((q) => Date.parse(q.observedAt!));
  const mismatched =
    observationTimes.length > 1 &&
    Math.max(...observationTimes) - Math.min(...observationTimes) >
      SWAP_MAX_SPREAD_MS;
  const inputUsd = mark(input);
  const outputUsd = mark(output);
  const shortfall = mismatched ? null : subtract(inputUsd, outputUsd);
  return {
    inputUsd,
    outputUsd,
    shortfall,
    bps: divide(shortfall, inputUsd, 10_000),
    mismatched,
  };
}
