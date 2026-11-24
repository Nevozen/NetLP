import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { EventEditor } from "@/components/editor";
import { Quotes } from "@/components/reports";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { eventNames } from "@/domain/presentation";
import { displayTime } from "@/lib/time";
import { editFields } from "@/server/form-data";
import { getCycle } from "@/server/workspace";

export const metadata = { title: "Journal event" };

export default async function EventDetails({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  const { id, eventId } = await params;
  const { cycle, journal, user } = await getCycle(id);
  const event = cycle.events.find((e) => e.entry.id === eventId);
  if (!event) notFound();
  const history = await journal.history(user.id, id, eventId);
  const zone = user.settings.timezone;
  const initial = {
    ...editFields(event.entry, cycle.market, zone),
    strategyId: id,
    command: randomUUID(),
  };
  const legs: [string, string][] = cycle.ledger.legs.map((leg) => [
    leg.definition.id,
    `${leg.definition.protocol} · ${leg.openedAt.slice(0, 10)}`,
  ]);
  return (
    <>
      <PageHeader
        eyebrow={`AUDIT / ${cycle.name}`}
        title={eventNames[event.entry.facts.kind]}
      >
        Posted facts and reference prices are immutable. Correct an open cycle
        by adding a reasoned revision.
      </PageHeader>
      <Panel title="Revision history">
        {history.map((revision) => (
          <details
            className="form-details"
            key={revision.version}
            open={revision.version === event.version}
          >
            <summary>
              Revision {revision.version} ·{" "}
              {displayTime(revision.recorded, zone)}
            </summary>
            <p>
              {revision.reason ?? "Original posting"}{" "}
              <Badge>{displayTime(revision.at, zone)}</Badge>
            </p>
            <Quotes
              prices={revision.prices}
              market={cycle.market}
              zone={zone}
            />
            <pre className="table-scroll">
              {JSON.stringify(revision.facts, null, 2)}
            </pre>
          </details>
        ))}
      </Panel>
      {!cycle.closedAt && (
        <Panel title="Correct this event">
          <EventEditor
            initial={initial}
            market={cycle.market}
            protocol={cycle.protocol}
            legs={legs}
            zone={zone}
            correction={{ id: eventId, version: event.version }}
          />
        </Panel>
      )}
    </>
  );
}
