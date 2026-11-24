import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { EventEditor } from "@/components/editor";
import { PageHeader, Panel } from "@/components/ui";
import { eventNames } from "@/domain/presentation";
import { localInput } from "@/lib/time";
import { getCycle } from "@/server/workspace";

export const metadata = { title: "Record transaction" };

export default async function NewEvent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; draft?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { user, cycle, journal } = await getCycle(id);
  if (cycle.closedAt) redirect(`/positions/${id}`);
  const draft = query.draft
    ? (await journal.drafts(user.id, id)).find((d) => d.id === query.draft)
    : undefined;
  if (query.draft && !draft) notFound();
  const kind =
    query.type &&
    Object.hasOwn(eventNames, query.type) &&
    query.type !== "OPENING_ALLOCATION"
      ? query.type
      : "SWAP";
  const zone = user.settings.timezone;
  const initial = {
    at: localInput(new Date().toISOString(), zone),
    kind,
    ...draft?.fields,
    strategyId: id,
    command: draft?.id ?? randomUUID(),
  };
  const legs: [string, string][] = cycle.ledger.legs
    .toReversed()
    .map((leg) => [
      leg.definition.id,
      `${leg.definition.protocol} · ${leg.definition.positionId ?? leg.openedAt.slice(0, 10)}${leg.closedAt ? " (settled)" : " (active)"}`,
    ]);
  return (
    <>
      <PageHeader
        eyebrow={`JOURNAL / ${cycle.name}`}
        title={
          initial.kind === "CLOSE_STRATEGY"
            ? "Close strategy"
            : draft
              ? "Resume draft"
              : "Record a transaction"
        }
      >
        Record what happened, not what you expected the trade to produce.
      </PageHeader>
      <Panel title="Journal entry">
        <EventEditor
          initial={initial}
          market={cycle.market}
          protocol={cycle.protocol}
          legs={legs}
          zone={zone}
        />
      </Panel>
    </>
  );
}
