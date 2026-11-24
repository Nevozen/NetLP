import type { StrategyView } from "@/server/journal";
import { pairName } from "./reports";
import { Button } from "./ui";

export type Query = Record<string, string | string[] | undefined>;
export const get = (q: Query, key: string, fallback = "") =>
  typeof q[key] === "string" ? q[key] : fallback;

export function selectCycles(
  cycles: StrategyView[],
  q: Query,
  defaultStatus = "all",
) {
  const status = get(q, "status", defaultStatus);
  const filter = get(q, "q").toLowerCase().trim();
  return cycles.filter(
    (cycle) =>
      (status === "all" ||
        (status === "closed" ? cycle.closedAt : !cycle.closedAt)) &&
      (!get(q, "network") || cycle.market.network === get(q, "network")) &&
      (!get(q, "protocol") || cycle.protocol === get(q, "protocol")) &&
      (!get(q, "pair") || pairName(cycle.market) === get(q, "pair")) &&
      (!get(q, "strategy") || cycle.id === get(q, "strategy")) &&
      (!filter ||
        [
          cycle.name,
          pairName(cycle.market),
          cycle.protocol,
          cycle.market.network,
          cycle.positionRef,
          ...cycle.ledger.legs.map((l) => l.definition.positionId),
        ].some((v) => v?.toLowerCase().includes(filter))),
  );
}

export function Filter({
  cycles,
  q,
  analytics = false,
  initialStatus = "all",
}: {
  cycles: StrategyView[];
  q: Query;
  analytics?: boolean;
  initialStatus?: string;
}) {
  const selects = [
    ["network", "Network", cycles.map((c) => c.market.network)],
    ["protocol", "Protocol", cycles.map((c) => c.protocol)],
    ...(analytics
      ? [["pair", "Pair", cycles.map((c) => pairName(c.market))] as const]
      : []),
  ] as const;
  return (
    <form method="get" className="filter" aria-label="Filter strategies">
      {!analytics && (
        <label className="field">
          Search
          <input
            type="search"
            name="q"
            placeholder="Pair, label, or position ID"
            defaultValue={get(q, "q")}
          />
        </label>
      )}
      {analytics && (
        <label className="field">
          Strategy
          <select name="strategy" defaultValue={get(q, "strategy")}>
            <option value="">All strategies</option>
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Cycle status
        <select name="status" defaultValue={get(q, "status", initialStatus)}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </label>
      {selects.map(([key, label, values]) => (
        <label className="field" key={key}>
          {label}
          <select name={key} defaultValue={get(q, key)}>
            <option value="">All</option>
            {[...new Set(values)].sort().map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      ))}
      {analytics && (
        <label className="field">
          Reporting period
          <select name="period" defaultValue={get(q, "period", "all")}>
            {[
              ["all", "All time"],
              ["7", "7D"],
              ["30", "30D"],
              ["90", "90D"],
              ["custom", "Custom dates"],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        {analytics ? "From (custom)" : "Opened from"}
        <input type="date" name="from" defaultValue={get(q, "from")} />
      </label>
      {analytics && (
        <label className="field">
          To (custom)
          <input type="date" name="to" defaultValue={get(q, "to")} />
        </label>
      )}
      <div className="actions">
        <Button type="submit" tone="outline">
          Apply filters
        </Button>
      </div>
    </form>
  );
}
