import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { MarkEditor } from "@/components/editor";
import { PageHeader, Panel } from "@/components/ui";
import { localInput } from "@/lib/time";
import { getCycle } from "@/server/workspace";

export const metadata = { title: "Refresh valuation" };

export default async function MarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { cycle, user } = await getCycle(id);
  if (cycle.closedAt) redirect(`/positions/${id}`);
  const zone = user.settings.timezone;
  return (
    <>
      <PageHeader eyebrow={cycle.name} title="Refresh valuation">
        Save one price vector for both the strategy and HODL. This does not
        refresh your observed pool composition.
      </PageHeader>
      <Panel title="Market mark">
        <MarkEditor
          market={cycle.market}
          zone={zone}
          initial={{
            strategyId: id,
            command: randomUUID(),
            at: localInput(new Date().toISOString(), zone),
          }}
        />
      </Panel>
    </>
  );
}
