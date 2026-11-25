import Link from "next/link";
import { Filter, get, type Query, selectCycles } from "@/components/filters";
import { PerformanceChart } from "@/components/performance-chart";
import {
  activity,
  JournalTable,
  Metric,
  pairName,
  reportedClaim,
} from "@/components/reports";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { add, divide } from "@/domain/values";
import { decimal, equivalent, usd } from "@/lib/display";
import { displayTime, localInput } from "@/lib/time";
import {
  aggregate,
  observations,
  ready,
  weightedReturn,
} from "@/server/analytics";
import { getWorkspace } from "@/server/workspace";

export const metadata = { title: "Analytics" };

export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { user, journal, requestTime } = await getWorkspace();
  const [all, q] = await Promise.all([journal.list(user.id), searchParams]);
  const zone = user.settings.timezone;
  const period = get(q, "period");
  const cutoff = ["7", "30", "90"].includes(period)
    ? requestTime - Number(period) * 86_400_000
    : null;
  const within = (at: string) => {
    if (cutoff !== null) return Date.parse(at) >= cutoff;
    if (period !== "custom") return true;
    const date = localInput(at, zone).slice(0, 10);
    return (
      (!get(q, "from") || date >= get(q, "from")) &&
      (!get(q, "to") || date <= get(q, "to"))
    );
  };
  const cycles = selectCycles(all, q);
  const outcomes = cycles.filter(
    (c) => !c.closedAt || within(c.closedAt.toISOString()),
  );
  const complete = outcomes.filter(ready);
  const events = activity(cycles).filter(({ line }) => within(line.entry.at));
  const total = (
    pick: (
      line: (typeof events)[number]["line"],
      item: (typeof events)[number],
    ) => string | null,
  ) =>
    events.length
      ? events.reduce<string | null>(
          (previous, item) => add(previous, pick(item.line, item)),
          "0",
        )
      : null;
  const chartCycle = cycles[0];
  const series = chartCycle
    ? observations(chartCycle, user.settings.denomination, within)
    : null;
  const groups = new Map<string, typeof cycles>();
  for (const cycle of outcomes) {
    const key = `${cycle.market.network} / ${cycle.protocol}`;
    groups.set(key, [...(groups.get(key) ?? []), cycle]);
  }
  const weighted = weightedReturn(complete);
  const claimed = total((_, item) => reportedClaim(item));
  const gas = total((line) => line.networkHistorical);
  const burden = divide(gas, claimed, 100);
  return (
    <>
      <PageHeader eyebrow="WORKSPACE / 04" title="Analytics">
        Separate market movement, fee efficiency, and outcomes relative to
        holding.
      </PageHeader>
      <Panel title="Report scope">
        <Filter cycles={all} q={q} analytics />
        <p className="muted mt-3">
          Operating costs are filtered by event date; closed-cycle results by
          closure date. Open results use current saved marks. The opening
          benchmark does not reset when you change the date filter.
        </p>
      </Panel>
      <div className="metrics">
        <Metric
          label="LP edge · cycle outcomes"
          value={usd(
            aggregate(complete, (e) => e.outperformance),
            true,
          )}
          note={`${complete.length} of ${outcomes.length} cycles · not a time-weighted return`}
        />
        <Metric
          label="HODL-weighted edge"
          value={weighted === null ? "N/A" : `${decimal(weighted, 4, true)}%`}
          note="Sum of outperformance ÷ sum of HODL"
        />
        <Metric
          label="Network fees · period"
          value={usd(gas)}
          note={`Other independent expenses ${usd(total((line) => line.otherHistorical))}`}
        />
        <Metric
          label="Claimed fee income · period"
          value={usd(claimed)}
          note="Claim-time USD; excludes pre-baseline receipts"
        />
        <Metric
          label="Gas burden · period"
          value={burden === null ? "N/A" : `${decimal(burden, 2)}%`}
          note="Historical network fees divided by claim-time LP fee income"
        />
        <Metric
          label="Entry swap shortfall · period"
          value={usd(
            total((line) =>
              line.entry.facts.kind === "SWAP" &&
              line.entry.facts.purpose === "ENTRY"
                ? line.swap!.shortfall
                : "0",
            ),
            true,
          )}
        />
        <Metric
          label="Exit swap shortfall · period"
          value={usd(
            total((line) =>
              line.entry.facts.kind === "SWAP" &&
              line.entry.facts.purpose === "EXIT"
                ? line.swap!.shortfall
                : "0",
            ),
            true,
          )}
        />
      </div>
      <Panel
        title={
          chartCycle
            ? `${chartCycle.name} · LP vs HODL`
            : "LP vs HODL observations"
        }
        label="OBSERVED POSITIONS ONLY"
        action={
          chartCycle ? (
            <Link className="link" href={`/positions/${chartCycle.id}`}>
              Actual asset composition
            </Link>
          ) : undefined
        }
      >
        {series?.points.length ? (
          <>
            <PerformanceChart points={series.points} label={series.label} />
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Observed ({zone})</th>
                    <th>Net wealth</th>
                    <th>HODL</th>
                    <th>Outperformance</th>
                  </tr>
                </thead>
                <tbody>
                  {series.points.toReversed().map((point) => (
                    <tr key={point.at}>
                      <td>{displayTime(point.at, zone)}</td>
                      {[point.strategy, point.hodl, point.spread].map(
                        (value, i) => (
                          <td className="num" key={i}>
                            {equivalent(value, series.label, i === 2)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty title="No dated marks in this range">
            A chart point needs recorded holdings and contemporaneous reference
            prices. Missing dates are not backfilled with current balances.
          </Empty>
        )}
        {series && (series.missing > 0 || series.truncated) && (
          <p className="alert warn">
            {series.missing} observation(s) lacked complete inputs.
            {series.truncated
              ? " Showing the latest 80 candidate observations in the selected range."
              : ""}
          </p>
        )}
        {cycles.length > 1 && (
          <p className="muted">
            Showing the first matching cycle. Choose a strategy in Report scope
            to chart another cycle.
          </p>
        )}
      </Panel>
      <div className="split">
        <Panel title="Network / protocol breakdown">
          {groups.size === 0 && (
            <p className="muted">No cycles in this report.</p>
          )}
          {[...groups].map(([name, group]) => (
            <div className="list-line" key={name}>
              <div>
                <strong>{name}</strong>
                <small>
                  {group.filter(ready).length} complete of {group.length} cycles
                </small>
              </div>
              <strong className="num">
                {usd(
                  aggregate(group.filter(ready), (e) => e.outperformance),
                  true,
                )}
              </strong>
            </div>
          ))}
        </Panel>
        <Panel title="Strategy outcomes">
          {outcomes.map((cycle) => (
            <div className="list-line" key={cycle.id}>
              <div>
                <Link className="link" href={`/positions/${cycle.id}`}>
                  {cycle.name}
                </Link>
                <small>
                  {pairName(cycle.market)} ·{" "}
                  {cycle.closedAt ? "Closed mark" : "Open mark"}
                  {ready(cycle) ? "" : " · excluded from totals"}
                </small>
              </div>
              <strong>{usd(cycle.evaluation.outperformance, true)}</strong>
            </div>
          ))}
          {!outcomes.length && <p className="muted">No eligible outcomes.</p>}
        </Panel>
      </div>
      <Panel title="Fee and operating expense timeline" label="HISTORICAL USD">
        <JournalTable items={events.slice(0, 100)} zone={zone} />
        {events.length > 100 && (
          <p>
            <Link className="link" href="/transactions">
              See all events in the journal
            </Link>
            . Showing the latest 100 of {events.length}.
          </p>
        )}
      </Panel>
    </>
  );
}
