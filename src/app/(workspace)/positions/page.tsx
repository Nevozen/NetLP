import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { Filter, get, type Query, selectCycles } from "@/components/filters";
import {
  CycleStatus,
  denominationFor,
  inReference,
  pairName,
} from "@/components/reports";
import { Badge, Button, Empty, PageHeader, Panel } from "@/components/ui";
import { sign, usd } from "@/lib/display";
import { displayTime, localInput } from "@/lib/time";
import { getWorkspace } from "@/server/workspace";

export const metadata = { title: "Positions" };

export default async function Positions({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { user, journal } = await getWorkspace();
  const [all, q] = await Promise.all([journal.list(user.id), searchParams]);
  const zone = user.settings.timezone;
  const from = get(q, "from");
  const cycles = selectCycles(all, q, "open").filter(
    (cycle) =>
      !from ||
      localInput(cycle.openedAt.toISOString(), zone).slice(0, 10) >= from,
  );
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / 02"
        title="Positions"
        actions={
          <Button asChild>
            <Link href="/positions/new">
              <Plus size={17} /> New strategy
            </Link>
          </Button>
        }
      >
        Follow independent allocations from the opening wallet through their
        final benchmark.
      </PageHeader>
      <Panel
        title="Strategy cycles"
        action={<Badge>{cycles.length} matching</Badge>}
      >
        <Filter cycles={all} q={q} initialStatus="open" />
        {cycles.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Strategy / market</th>
                  <th>Status & freshness</th>
                  <th>Principal</th>
                  <th>Idle wallet</th>
                  <th>Gross fees</th>
                  <th>Costs</th>
                  <th>Net fee income</th>
                  <th>vs HODL</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => {
                  const { evaluation: e } = cycle;
                  const reference = denominationFor(
                    cycle,
                    user.settings.denomination,
                  );
                  const status = e.notices.some((n) => n.kind === "INCOMPLETE")
                    ? "Incomplete"
                    : e.notices.some((n) => n.kind === "STALE")
                      ? "Stale mark"
                      : "";
                  return (
                    <tr key={cycle.id}>
                      <td>
                        <Link className="link" href={`/positions/${cycle.id}`}>
                          {cycle.name}{" "}
                          <ArrowUpRight size={13} className="inline" />
                        </Link>
                        <small className="block muted">
                          {pairName(cycle.market)} · {cycle.market.network} ·{" "}
                          {cycle.protocol}
                        </small>
                        <small className="block muted">
                          Opened {displayTime(cycle.openedAt, zone)}
                        </small>
                      </td>
                      <td>
                        <CycleStatus cycle={cycle} />
                        {status && (
                          <small className="block muted">{status}</small>
                        )}
                      </td>
                      <td className="num">
                        {inReference(e.principalUsd, reference)}
                      </td>
                      <td className="num">
                        {inReference(e.walletUsd, reference)}
                      </td>
                      <td className="num">
                        {inReference(e.grossMarked, reference)}
                      </td>
                      <td className="num">{usd(e.operationalCosts)}</td>
                      <td className="num">
                        {usd(e.netIncomeWithPending, true)}
                      </td>
                      <td className={`num ${sign(e.outperformance)}`}>
                        {inReference(e.outperformance, reference, true)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={all.length ? "No matching cycles" : "Your book is empty"}
            action={
              all.length ? (
                <Link className="link" href="/positions?status=all">
                  Show all cycles
                </Link>
              ) : (
                <Button asChild>
                  <Link href="/positions/new">Create a strategy</Link>
                </Button>
              )
            }
          >
            {all.length
              ? "Change the filters or view all open and closed cycles."
              : "Start with your actual opening quantities. Prices can be fetched or entered manually."}
          </Empty>
        )}
      </Panel>
    </>
  );
}
