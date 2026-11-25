import { randomUUID } from "node:crypto";
import { OpenEditor } from "@/components/editor";
import { PageHeader, Panel } from "@/components/ui";
import { localInput } from "@/lib/time";
import { requireUser } from "@/server/session";

export const metadata = { title: "New strategy" };

export default async function NewPosition() {
  const user = await requireUser();
  const zone = user.settings.timezone;
  return (
    <>
      <PageHeader eyebrow="POSITIONS / NEW CYCLE" title="Create a strategy">
        Start before your first swap, or label an imported position with a
        partial benchmark.
      </PageHeader>
      <Panel title="Strategy setup">
        <OpenEditor
          zone={zone}
          initial={{
            command: randomUUID(),
            at: localInput(new Date().toISOString(), zone),
          }}
        />
      </Panel>
    </>
  );
}
