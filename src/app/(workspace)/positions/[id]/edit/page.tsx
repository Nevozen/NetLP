import { MetadataEditor } from "@/components/editor";
import { PageHeader, Panel } from "@/components/ui";
import { getCycle } from "@/server/workspace";

export const metadata = { title: "Edit strategy metadata" };

export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { cycle } = await getCycle((await params).id);
  return (
    <>
      <PageHeader eyebrow={cycle.name} title="Edit metadata">
        Update labels and references without rewriting any financial inputs.
      </PageHeader>
      <Panel title="Strategy details">
        <MetadataEditor
          initial={{
            strategyId: cycle.id,
            name: cycle.name,
            protocol: cycle.protocol,
            walletAddress: cycle.walletAddress ?? "",
            positionRef: cycle.positionRef ?? "",
            strategyNotes: cycle.notes ?? "",
          }}
        />
      </Panel>
    </>
  );
}
