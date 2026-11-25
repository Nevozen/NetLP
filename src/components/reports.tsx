import Link from "next/link";
import type { ReactNode } from "react";
import { referenceAsset } from "@/domain/catalog";
import { compareEntries, type EventResult } from "@/domain/ledger";
import { type Market, type PriceVector, tokens } from "@/domain/model";
import { eventNames, positionsStates } from "@/domain/presentation";
import { divide, tokenPrice } from "@/domain/values";
import { decimal, equivalent, human, sign, usd } from "@/lib/display";
import { displayTime } from "@/lib/time";
import type { StrategyView } from "@/server/journal";
import { Badge } from "./ui";

export const pairName = (market: Market) =>
  market.pair.map((token) => token.symbol).join(" / ");

export function denominationFor(cycle: StrategyView, denomination: string) {
  const asset = cycle.market.pair.find((token) =>
    referenceAsset(token.id, denomination),
  );
  return {
    label: asset ? denomination : "USD",
    divisor: asset ? tokenPrice(asset.id, cycle.mark.prices) : "1",
  };
}

export function inReference(
  value: string | null,
  reference: ReturnType<typeof denominationFor>,
  signed = false,
) {
  return equivalent(divide(value, reference.divisor), reference.label, signed);
}

export function Metric({
  label,
  value,
  note,
  direction,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  direction?: string | null;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={`num ${sign(direction)}`}>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export function CycleStatus({ cycle }: { cycle: StrategyView }) {
  const range = cycle.ledger.activeLeg?.position?.range;
  return (
    <div className="chips">
      <Badge tone={cycle.closedAt ? "neutral" : "good"}>
        {cycle.closedAt ? "Closed" : "Open"}
      </Badge>
      {!cycle.closedAt && (
        <Badge tone={range === "OUT_OF_RANGE" ? "warn" : "neutral"}>
          {cycle.ledger.activeLeg
            ? range
              ? positionsStates[range]
              : "Snapshot pending"
            : "Wallet only"}
        </Badge>
      )}
    </div>
  );
}

export function Quotes({
  prices,
  market,
  zone,
}: {
  prices: PriceVector;
  market: Market;
  zone: string;
}) {
  if (!prices.length)
    return <p className="muted">No reference prices saved.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>USD reference</th>
            <th>Source / quality</th>
            <th>Observed ({zone})</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.asset}>
              <td>
                {tokens(market).find((t) => t.id === p.asset)?.symbol ??
                  p.asset}
              </td>
              <td className="num">
                {p.usd === null ? "N/A" : `$${decimal(p.usd)}`}
              </td>
              <td>
                {p.source} · {human(p.quality)}
                {p.providerAsset && (
                  <small className="muted block">{p.providerAsset}</small>
                )}
                {p.note && <small className="muted block">{p.note}</small>}
              </td>
              <td className="nowrap">
                {p.observedAt ? displayTime(p.observedAt, zone) : "Unknown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type Activity = { cycle: StrategyView; line: EventResult };
export const activity = (cycles: StrategyView[]): Activity[] =>
  cycles
    .flatMap((cycle) => cycle.ledger.results.map((line) => ({ cycle, line })))
    .sort(
      (a, b) =>
        compareEntries(b.line.entry, a.line.entry) ||
        a.cycle.id.localeCompare(b.cycle.id),
    );

export function JournalTable({
  items,
  zone,
}: {
  items: Activity[];
  zone: string;
}) {
  if (!items.length)
    return <p className="muted">No journal events match these filters.</p>;
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Transaction journal"
    >
      <table>
        <thead>
          <tr>
            <th>Time ({zone})</th>
            <th>Event</th>
            <th>Strategy</th>
            <th>Swap shortfall</th>
            <th>Network cost</th>
            <th>Other cost</th>
            <th>Claimed earned fees</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ cycle, line }) => {
            const { entry } = line;
            return (
              <tr key={entry.id}>
                <td className="nowrap">{displayTime(entry.at, zone)}</td>
                <td>
                  <Link
                    className="link"
                    href={`/positions/${cycle.id}/event/${entry.id}`}
                  >
                    {eventNames[entry.facts.kind]}
                  </Link>
                  {"purpose" in entry.facts && (
                    <small className="muted block">
                      {human(entry.facts.purpose)}
                    </small>
                  )}
                  {entry.facts.group && (
                    <small className="muted block">{entry.facts.group}</small>
                  )}
                  {entry.walletOrigin && (
                    <small className="muted block">Base wallet import</small>
                  )}
                </td>
                <td>
                  <Link href={`/positions/${cycle.id}`}>{cycle.name}</Link>
                </td>
                <td className="num">
                  {line.swap ? usd(line.swap.shortfall, true) : "-"}
                </td>
                <td className="num">{usd(line.networkHistorical)}</td>
                <td className="num">{usd(line.otherHistorical)}</td>
                <td className="num">{usd(reportedClaim({ cycle, line }))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function reportedClaim({ cycle, line }: Activity) {
  const facts = line.entry.facts;
  const legId = "legId" in facts ? facts.legId : undefined;
  const unavailable =
    Object.keys(line.received).length > 0 &&
    cycle.ledger.legs.some(
      (leg) =>
        leg.definition.id === legId &&
        leg.definition.feeAttribution === "UNAVAILABLE",
    );
  return unavailable ? null : line.claimedHistorical;
}
