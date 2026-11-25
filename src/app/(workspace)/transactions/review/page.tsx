import Link from "next/link";
import type { ComponentProps } from "react";
import { get, type Query } from "@/components/filters";
import { Button, PageHeader, Panel } from "@/components/ui";
import { ethUnits } from "@/components/wallet-activity";
import { WalletReview } from "@/components/wallet-review";
import { AccountingError } from "@/domain/values";
import { database } from "@/server/db";
import { evidenceSchema } from "@/server/onchain/activity";
import { pancakeDraftSchema } from "@/server/onchain/pancake-v3";
import {
  eligibleWalletStrategy,
  selectedActivity,
} from "@/server/onchain/wallet-review";
import { createWalletStore } from "@/server/onchain/wallet-store";
import { getWorkspace } from "@/server/workspace";

export const metadata = { title: "Review wallet activity" };

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { user, journal } = await getWorkspace();
  const db = database();
  const ids = get(await searchParams, "ids")
    .slice(0, 380)
    .split(",");
  const watch = await createWalletStore(db).watch(user.id);
  let model: ComponentProps<typeof WalletReview> | undefined;
  let issue: string | undefined;
  try {
    if (!watch)
      throw new AccountingError("Save a Base wallet address before reviewing.");
    const [rows, cycles] = await Promise.all([
      selectedActivity(db, watch, ids),
      journal.list(user.id),
    ]);
    model = {
      zone: user.settings.timezone,
      strategies: cycles
        .filter((cycle) => eligibleWalletStrategy(cycle, watch.address))
        .map((cycle) => ({
          id: cycle.id,
          name: cycle.name,
          baseline: cycle.evaluation.baseline
            .replaceAll("_", " ")
            .toLowerCase(),
        })),
      rows: rows.map((row) => {
        const { fees } = evidenceSchema.parse(row.evidence);
        return {
          id: row.id,
          txHash: row.txHash,
          at: row.occurredAt!.toISOString(),
          block: row.blockNumber!.toString(),
          revision: row.revision,
          fee: fees.total && fees.total !== "0" ? ethUnits(fees.total) : null,
          actions: pancakeDraftSchema.parse(row.draft).actions,
        };
      }),
    };
  } catch (error) {
    if (!(error instanceof AccountingError)) throw error;
    issue = error.message;
  }
  return (
    <>
      <PageHeader
        eyebrow="TRANSACTIONS / BASE IMPORT"
        title="Review wallet activity"
        actions={
          <Button asChild tone="outline">
            <Link href="/transactions?view=wallet">
              Back to Wallet activity
            </Link>
          </Button>
        }
      >
        Confirm the strategy and review the amounts. Nothing enters the ledger
        until you post the batch.
      </PageHeader>
      {model ? (
        <WalletReview {...model} />
      ) : (
        <Panel title="Selection unavailable">
          <p role="alert">{issue}</p>
        </Panel>
      )}
    </>
  );
}
