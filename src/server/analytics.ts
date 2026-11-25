import { referenceAsset } from "@/domain/catalog";
import { replay } from "@/domain/ledger";
import { evaluate, type Evaluation } from "@/domain/performance";
import { AccountingError, add, divide } from "@/domain/values";
import type { StrategyView } from "./journal";

export function ready(cycle: StrategyView) {
  return (
    cycle.evaluation.netWealth !== null &&
    cycle.evaluation.hodl !== null &&
    !cycle.evaluation.notices.some(
      (n) => n.kind === "STALE" || n.kind === "INCOMPLETE",
    )
  );
}

export function aggregate(
  cycles: StrategyView[],
  select: (e: Evaluation) => string | null,
) {
  if (!cycles.length) return null;
  return cycles.reduce<string | null>(
    (previous, cycle) => add(previous, select(cycle.evaluation)),
    "0",
  );
}

export function portfolioReference(cycles: StrategyView[], den: string) {
  const sorted = [...cycles].sort((a, b) => b.mark.at.localeCompare(a.mark.at));
  for (const cycle of sorted) {
    const price = cycle.mark.prices.find(
      (q) => q.usd !== null && referenceAsset(q.asset, den),
    );
    if (price) return { label: den, divisor: price.usd, cycle, price };
  }
  return { label: "USD", divisor: "1" };
}

export type Observation = {
  at: string;
  strategy: string;
  hodl: string;
  spread: string;
};

export function observations(
  cycle: StrategyView,
  den: string,
  within: (at: string) => boolean,
) {
  const entries = cycle.events.map(({ entry }) => entry);
  const candidates = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const facts = entry.facts;
    if (
      (facts.kind === "OPENING_ALLOCATION" ||
        facts.kind === "CLOSE_STRATEGY" ||
        ("snapshot" in facts && Boolean(facts.snapshot))) &&
      within(entry.at)
    ) {
      candidates.set(entry.at, entry);
    }
  }
  const eligible = [...candidates.values()];
  const points: Observation[] = [];
  let missing = 0;
  const asset = cycle.market.pair.find((token) =>
    referenceAsset(token.id, den),
  );
  for (const entry of eligible.slice(-80)) {
    try {
      const history = replay(
        cycle.market,
        entries.filter((event) => event.at <= entry.at),
      );
      if (history.activeLeg && history.activeLeg.position?.at !== entry.at) {
        missing++;
        continue;
      }
      const result = history.closedAt
        ? cycle.evaluation
        : evaluate(
            cycle.market,
            history,
            entry.at,
            history.results.at(-1)!.entry.prices,
          );
      const values = asset ? result.equivalents[asset.id] : result;
      if (
        values.netWealth === null ||
        values.hodl === null ||
        values.outperformance === null
      ) {
        missing++;
      } else {
        points.push({
          at: entry.at,
          strategy: values.netWealth,
          hodl: values.hodl,
          spread: values.outperformance,
        });
      }
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      missing++;
    }
  }
  const label = asset ? den : "USD";
  return { points, label, missing, truncated: eligible.length > 80 };
}

export function weightedReturn(cycles: StrategyView[]) {
  return divide(
    aggregate(cycles, (e) => e.outperformance),
    aggregate(cycles, (e) => e.hodl),
    100,
  );
}
