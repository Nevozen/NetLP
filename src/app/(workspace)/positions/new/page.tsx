import { randomUUID } from "node:crypto";
import { OpenEditor } from "@/components/editor";
import { get, type Query } from "@/components/filters";
import { PageHeader, Panel } from "@/components/ui";
import { localInput } from "@/lib/time";
import { database } from "@/server/db";
import { importedProtocol } from "@/server/onchain/wallet-review";
import { createWalletStore } from "@/server/onchain/wallet-store";
import { requireUser } from "@/server/session";

export const metadata = { title: "New strategy" };

export default async function NewPosition({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const user = await requireUser();
  const zone = user.settings.timezone;
  const fromWallet = get(await searchParams, "from") === "wallet";
  const watch = fromWallet
    ? await createWalletStore(database()).watch(user.id)
    : null;
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
            ...(watch
              ? {
                  preset: "base",
                  protocol: importedProtocol,
                  walletAddress: watch.address,
                }
              : {}),
          }}
        />
      </Panel>
    </>
  );
}
