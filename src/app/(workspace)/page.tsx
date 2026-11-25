import { ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import {
  activity,
  CycleStatus,
  inReference,
  JournalTable,
  Metric,
  pairName,
} from "@/components/reports";
import { Badge, Button, Empty, PageHeader, Panel } from "@/components/ui";
import { usd } from "@/lib/display";
import { displayTime } from "@/lib/time";
import { aggregate, portfolioReference, ready } from "@/server/analytics";
import { getWorkspace } from "@/server/workspace";

export default async function Home() {
  const { user, journal } = await getWorkspace();
  const cycles = await journal.list(user.id);
  const open = cycles.filter((cycle) => !cycle.closedAt);
  const closed = cycles.filter((cycle) => cycle.closedAt);
  const complete = cycles.filter(ready);
  const completeOpen = open.filter(ready);
  const reference = portfolioReference(
    completeOpen,
    user.settings.denomination,
  );
  const zone = user.settings.timezone;
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / 01"
        title="Overview"
        actions={
          <Button asChild>
            <Link href="/positions/new">
              <Plus size={17} /> New strategy
            </Link>
          </Button>
        }
      >
        See what your liquidity earned after costs, and what holding would have
        earned instead.
      </PageHeader>
      <section aria-label="Open strategy wealth" className="hero">
        <div>
          <p className="eyebrow">NET WEALTH / OPEN STRATEGIES</p>
          <strong className="num">
            {inReference(
              aggregate(completeOpen, (e) => e.netWealth),
              reference,
            )}
          </strong>
          <p className="hero-label">
            {open.length
              ? `${completeOpen.length} of ${open.length} open cycles with complete, current data`
              : "Waiting for an opening allocation"}
          </p>
        </div>
        <div className="hero-aside">
          <div>
            <small>Original HODL benchmark</small>
            <strong className="num">
              {inReference(
                aggregate(completeOpen, (e) => e.hodl),
                reference,
              )}
            </strong>
          </div>
          <div>
            <small>Net outperformance</small>
            <strong className="num">
              {inReference(
                aggregate(completeOpen, (e) => e.outperformance),
                reference,
                true,
              )}
            </strong>
          </div>
        </div>
      </section>
      {reference.cycle ? (
        <p className="muted">
          Portfolio USD sums converted to {reference.label} equivalent using{" "}
          {reference.cycle.market.network} {reference.label} from{" "}
          {reference.price.source},{" "}
          {displayTime(
            reference.price.observedAt ?? reference.price.requestedAt,
            zone,
          )}{" "}
          ({zone}). Not an actual holding.
        </p>
      ) : (
        user.settings.denomination !== "USD" && (
          <p className="muted">
            No suitable open-cycle {user.settings.denomination} quote is
            available for a portfolio conversion. Totals stay in USD.
          </p>
        )
      )}
      {complete.length < cycles.length && (
        <p className="alert warn">
          Partial portfolio: {cycles.length - complete.length} cycle(s) with
          unresolved or stale inputs are excluded from the performance and fee
          totals. Their records remain available below.
        </p>
      )}
      <div className="metrics">
        <Metric
          label="Allocated capital · open"
          value={usd(aggregate(open, (e) => e.openingCapital))}
          note={`Closed allocations: ${usd(aggregate(closed, (e) => e.openingCapital))}`}
        />
        <Metric
          label="Economic PnL · all"
          value={usd(
            aggregate(complete, (e) => e.totalPnl),
            true,
          )}
          direction={aggregate(complete, (e) => e.totalPnl)}
          note="Open marks + closed outcomes"
        />
        <Metric
          label="Gross LP fees · marked"
          value={usd(aggregate(complete, (e) => e.grossMarked))}
          note={`Claimed ${usd(aggregate(complete, (e) => e.claimedMarked))} · pending ${usd(aggregate(complete, (e) => e.pendingMarked))}`}
        />
        <Metric
          label="Swap shortfall · historical"
          value={usd(
            aggregate(complete, (e) => e.executionShortfall),
            true,
          )}
          note="Independent event-time reference"
        />
        <Metric
          label="Network fees · historical"
          value={usd(aggregate(complete, (e) => e.networkHistorical))}
          note={`Independent expenses ${usd(aggregate(complete, (e) => e.otherHistorical))}`}
        />
        <Metric
          label="Net fee income incl. pending"
          value={usd(
            aggregate(complete, (e) => e.netIncomeWithPending),
            true,
          )}
          note="Mixed historical and marked basis"
        />
      </div>
      <div className="split wide">
        <Panel
          title="Open strategies"
          label="POSITIONS"
          action={
            <Badge>
              {open.length} open · {closed.length} closed
            </Badge>
          }
        >
          {open.length ? (
            open.slice(0, 6).map((cycle) => (
              <div className="list-line" key={cycle.id}>
                <div>
                  <Link className="link" href={`/positions/${cycle.id}`}>
                    {cycle.name}
                  </Link>
                  <small>
                    {pairName(cycle.market)} · {cycle.market.network}
                  </small>
                </div>
                <CycleStatus cycle={cycle} />
                <Link
                  href={`/positions/${cycle.id}`}
                  aria-label={`Open ${cycle.name}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              </div>
            ))
          ) : (
            <Empty
              title="No active strategy"
              action={
                <Button asChild tone="outline">
                  <Link href="/positions/new">
                    Record opening allocation <ArrowRight size={15} />
                  </Link>
                </Button>
              }
            >
              Use the tokens you actually set aside. LPStacks compares strategy
              wealth with the value of holding those same assets.
            </Empty>
          )}
        </Panel>
        <Panel title="Measurement rules" label="LP VS HOLDING">
          <div className="stack">
            <div>
              <h3>01 / Record facts</h3>
              <p className="muted">
                Wallet, principal, and unclaimed fees are separate. A fee claim
                moves assets; it does not mint income again.
              </p>
            </div>
            <div className="divider" />
            <div>
              <h3>02 / Mark together</h3>
              <p className="muted">
                Strategy and HODL use the same reference prices. Only externally
                funded expenses are deducted from held assets at evaluation.
              </p>
            </div>
            <Link className="link" href="/analytics">
              Explore performance <ArrowUpRight size={13} className="inline" />
            </Link>
          </div>
        </Panel>
      </div>
      <Panel
        title="Recent activity"
        action={
          <Link className="link" href="/transactions">
            Full journal
          </Link>
        }
      >
        <JournalTable items={activity(cycles).slice(0, 6)} zone={zone} />
      </Panel>
    </>
  );
}
