import { ArrowDownToLine, ArrowUpRight, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  activity,
  CycleStatus,
  denominationFor,
  inReference,
  JournalTable,
  Metric,
  pairName,
  Quotes,
} from "@/components/reports";
import { Badge, Button, PageHeader, Panel } from "@/components/ui";
import { tokens } from "@/domain/model";
import { positionsStates } from "@/domain/presentation";
import { add } from "@/domain/values";
import { decimal, equivalent, human, usd } from "@/lib/display";
import { displayTime } from "@/lib/time";
import { getCycle } from "@/server/workspace";

export const metadata = { title: "Strategy journal" };

export default async function StrategyDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, cycle, journal } = await getCycle(id);
  const { evaluation: e, ledger, market } = cycle;
  const zone = user.settings.timezone;
  const drafts = !cycle.closedAt ? await journal.drafts(user.id, id) : [];
  const ref = denominationFor(cycle, user.settings.denomination);
  const base = `/positions/${id}`;
  return (
    <>
      <PageHeader
        eyebrow="POSITIONS / STRATEGY"
        title={cycle.name}
        actions={
          <>
            <Button asChild tone="outline">
              <a href={`${base}/export`}>
                <ArrowDownToLine size={15} /> Export CSV
              </a>
            </Button>
            {!cycle.closedAt && (
              <Button asChild>
                <Link href={`${base}/event`}>
                  <Plus size={16} /> Record transaction
                </Link>
              </Button>
            )}
          </>
        }
      >
        {pairName(market)} · {market.network} · {cycle.protocol} · Opened{" "}
        {displayTime(cycle.openedAt, zone)}
      </PageHeader>
      <nav className="chips" aria-label="Strategy sections">
        <CycleStatus cycle={cycle} />
        <a className="link" href="#ledger">
          Ledger
        </a>
        <a className="link" href="#snapshots">
          Position snapshots
        </a>
        <a className="link" href="#fees">
          Fees &amp; costs
        </a>
        <a className="link" href="#notes">
          Notes
        </a>
      </nav>
      <div className="metrics">
        <Metric
          label={cycle.closedAt ? "Frozen net wealth" : "Net strategy wealth"}
          value={inReference(e.netWealth, ref)}
          note={
            ref.label === "USD"
              ? "USD at the saved evaluation"
              : `${ref.label} equivalent at the saved evaluation`
          }
        />
        <Metric
          label="Original HODL benchmark"
          value={inReference(e.hodl, ref)}
          note={human(e.baseline)}
        />
        <Metric
          label="Outperformance vs HODL"
          value={inReference(e.outperformance, ref, true)}
          direction={e.outperformance}
          note={`${decimal(e.relativePerformance, 4, true)}${e.relativePerformance === null ? "" : "%"} of HODL`}
        />
        <Metric
          label="Total economic PnL"
          value={usd(e.totalPnl, true)}
          direction={e.totalPnl}
          note={`Opening allocation: ${usd(e.openingCapital)}`}
        />
      </div>
      {!!e.notices.length && (
        <div aria-label="Data quality">
          {e.notices.map((notice) => (
            <p
              key={notice.message}
              className={`alert ${notice.kind === "INCOMPLETE" || notice.kind === "STALE" ? "warn" : ""}`}
            >
              {notice.message}
            </p>
          ))}
        </div>
      )}
      <div className="split wide">
        <Panel title="Actual token holdings" label="RECORDED QUANTITIES">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Opening</th>
                  <th>Wallet</th>
                  <th>LP principal</th>
                  <th>Unclaimed</th>
                  <th>Total held</th>
                  <th>External spend</th>
                </tr>
              </thead>
              <tbody>
                {tokens(market).map((token) => {
                  const { opening, wallet, principal, unclaimed, external } =
                    e.quantities;
                  const p = Object.hasOwn(principal, token.id)
                    ? principal[token.id]
                    : "0";
                  const u = Object.hasOwn(unclaimed, token.id)
                    ? unclaimed[token.id]
                    : "0";
                  return (
                    <tr key={token.id}>
                      <th title={token.id}>{token.symbol}</th>
                      {[
                        opening[token.id] ?? "0",
                        wallet[token.id] ?? "0",
                        p,
                        u,
                        add(add(wallet[token.id] ?? "0", p), u),
                        external[token.id] ?? "0",
                      ].map((v, i) => (
                        <td className="num" key={i}>
                          {decimal(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <small className="muted">
            External spend is not a holding. Claimed fees are already in the
            recorded balances or have been spent.
          </small>
        </Panel>
        <Panel title="Value equivalents" label="NOT EXECUTABLE QUOTES">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Net wealth</th>
                  <th>HODL</th>
                  <th>vs HODL</th>
                  <th>Change since opening</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>USD</th>
                  {[e.netWealth, e.hodl, e.outperformance, e.totalPnl].map(
                    (v, i) => (
                      <td key={i}>{usd(v, i > 1)}</td>
                    ),
                  )}
                </tr>
                {market.pair.map((token) => {
                  const v = e.equivalents[token.id];
                  return (
                    <tr key={token.id}>
                      <th>{token.symbol} eq.</th>
                      {[
                        v.netWealth,
                        v.hodl,
                        v.outperformance,
                        v.wealthChange,
                      ].map((metric, i) => (
                        <td key={i}>
                          {equivalent(metric, token.symbol, i > 1)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <small className="muted">
            Cross-rate: {decimal(e.crossRates.token1PerToken0, 8)}{" "}
            {market.pair[1].symbol} per 1 {market.pair[0].symbol}; inverse{" "}
            {decimal(e.crossRates.token0PerToken1, 8)} {market.pair[0].symbol}{" "}
            per 1 {market.pair[1].symbol}.
          </small>
        </Panel>
      </div>
      <Panel
        title="Evaluation reference prices"
        label={`${cycle.mark.type === "FROZEN" ? "FROZEN" : "AS OF"} · ${displayTime(cycle.mark.at, zone)} ${zone}`}
        action={
          !cycle.closedAt && (
            <Button asChild tone="outline">
              <Link href={`${base}/mark`}>
                <RefreshCw size={14} /> Refresh valuation
              </Link>
            </Button>
          )
        }
      >
        <Quotes prices={cycle.mark.prices} market={market} zone={zone} />
      </Panel>
      <div id="snapshots">
        <Panel
          title="LP legs and position snapshots"
          action={
            !cycle.closedAt && (
              <Button asChild tone="outline">
                <Link
                  href={`${base}/event?type=${ledger.activeLeg ? "POSITION_SNAPSHOT" : "ADD_LIQUIDITY"}`}
                >
                  {ledger.activeLeg
                    ? "Update snapshot"
                    : ledger.legs.length
                      ? "Open next LP leg"
                      : "Open LP leg"}
                </Link>
              </Button>
            )
          }
        >
          {!ledger.legs.length && (
            <p className="muted">No liquidity deposited or imported.</p>
          )}
          {ledger.legs.map((leg) => (
            <div key={leg.definition.id} className="list-line">
              <div>
                <strong>{leg.definition.protocol}</strong>
                <small>
                  {leg.definition.pool ?? "Pool reference not set"}
                  {leg.definition.positionId
                    ? ` · Position ${leg.definition.positionId}`
                    : ""}
                  {leg.definition.feeTier ? ` · ${leg.definition.feeTier}` : ""}
                </small>
                {leg.definition.lower && (
                  <small>
                    Range {leg.definition.lower} – {leg.definition.upper}{" "}
                    {market.pair[1].symbol} per {market.pair[0].symbol}
                  </small>
                )}
                <small>
                  {leg.position
                    ? `Observed ${displayTime(leg.position.at, zone)} · ${leg.position.source} · ${positionsStates[leg.position.range]}`
                    : "No reconciled observation"}
                </small>
              </div>
              <div className="chips">
                <Badge>{leg.closedAt ? "Settled" : "Active"}</Badge>
                {leg.position && (
                  <Link
                    href={`${base}/event/${leg.position.eventId}`}
                    aria-label="View latest position observation"
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                )}
              </div>
            </div>
          ))}
          <details className="form-details">
            <summary>All observed snapshots</summary>
            <JournalTable
              items={activity([cycle]).filter(
                ({ line }) =>
                  ("snapshot" in line.entry.facts &&
                    !!line.entry.facts.snapshot) ||
                  (line.entry.facts.kind === "OPENING_ALLOCATION" &&
                    !!line.entry.facts.imported),
              )}
              zone={zone}
            />
          </details>
        </Panel>
      </div>
      <div id="fees">
        <Panel
          title="Fees and operating costs"
          label="FEE EFFICIENCY IS NOT WEALTH PNL"
        >
          <div className="metrics">
            <Metric
              label="Gross fees at mark"
              value={usd(e.grossMarked)}
              note={`Claimed ${usd(e.claimedMarked)} · earned pending ${usd(e.pendingMarked)}`}
            />
            <Metric
              label="Claimed fee income"
              value={usd(e.claimedHistorical)}
              note="USD at claim time; excludes inherited fees"
            />
            <Metric
              label="Swap execution shortfall"
              value={usd(e.executionShortfall, true)}
              note="Independent event-time quotes"
            />
            <Metric
              label="Network fees"
              value={usd(e.networkHistorical)}
              note={`Other expenses ${usd(e.otherHistorical)} at event time`}
            />
            <Metric
              label="Net claimed fee income"
              value={usd(e.netClaimedIncome, true)}
              note="Claim-time fees minus historical costs"
            />
            <Metric
              label="Net fee income incl. pending"
              value={usd(e.netIncomeWithPending, true)}
              note="Mixed basis: historical net claimed plus marked earned pending"
            />
            <Metric
              label="External expense mark"
              value={usd(e.externalMark)}
              note={`Historical ${usd(e.externalHistorical)}; deducted once from wealth`}
            />
            <Metric
              label="LP leg divergence"
              value={usd(e.divergence, true)}
              note="Single-deposit active legs only; principal vs original deposit, excludes fees."
            />
          </div>
          <p className="muted mt-3">
            Claimed:{" "}
            {market.pair
              .map(
                (t) =>
                  `${decimal(e.quantities.claimed[t.id] ?? "0")} ${t.symbol}`,
              )
              .join(" · ")}
            . This is historical receipt attribution, not an additional asset
            bucket.
          </p>
        </Panel>
      </div>
      <div id="ledger">
        <Panel
          title="Cycle ledger"
          action={
            drafts.length > 0 ? (
              <Badge tone="warn">
                {drafts.length} draft{drafts.length === 1 ? "" : "s"}
              </Badge>
            ) : undefined
          }
        >
          {drafts.map((draft) => (
            <div className="list-line" key={draft.id}>
              <span>{human(draft.fields.kind || "transaction")} draft</span>
              <Link className="link" href={`${base}/event?draft=${draft.id}`}>
                Resume draft
              </Link>
            </div>
          ))}
          <JournalTable items={activity([cycle])} zone={zone} />
        </Panel>
      </div>
      <div id="notes">
        <Panel
          title="Strategy notes and references"
          action={
            <Button asChild tone="outline">
              <Link href={`${base}/edit`}>Edit metadata</Link>
            </Button>
          }
        >
          <p className="break whitespace-pre-wrap">
            {cycle.notes || "No strategy notes."}
          </p>
          {cycle.walletAddress && (
            <p className="break muted">
              Wallet reference: {cycle.walletAddress}
            </p>
          )}
          {cycle.positionRef && (
            <p className="break muted">
              Position reference: {cycle.positionRef}
            </p>
          )}
          {!cycle.closedAt && (
            <div className="actions mt-4">
              <Button asChild tone="outline">
                <Link href={`${base}/event?type=CLOSE_STRATEGY`}>
                  Close strategy
                </Link>
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
