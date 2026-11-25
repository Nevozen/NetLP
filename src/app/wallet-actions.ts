"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { presets } from "@/domain/catalog";
import {
  hash,
  type Amounts,
  type EventFacts,
  type Market,
  type PriceVector,
} from "@/domain/model";
import { AccountingError, requireFact } from "@/domain/values";
import { database } from "@/server/db";
import { field, fieldsFrom, priceChoices } from "@/server/form-data";
import { createJournal, MissingRecord } from "@/server/journal";
import { baseEndpoints, ProviderError } from "@/server/onchain/base-rpc";
import { classifyPancake } from "@/server/onchain/pancake-v3";
import { csvHashes, MAX_CSV_BYTES } from "@/server/onchain/wallet-csv";
import {
  activityIds,
  selectedActivity,
  verifyWalletReview,
  walletGroupsFrom,
} from "@/server/onchain/wallet-review";
import { createWalletStore } from "@/server/onchain/wallet-store";
import { createWalletSync, walletProvider } from "@/server/onchain/wallet-sync";
import { collectPrices } from "@/server/pricing";
import { limitOwnerRequest } from "@/server/request-limit";
import { requireUser } from "@/server/session";

export type WalletFormState = { error?: string; message?: string };
export type ReviewState = WalletFormState & {
  preview?: {
    id: string;
    netWealth: string | null;
    outperformance: string | null;
    wallet: Amounts;
    market: Market;
    groups: { hash: string; prices: PriceVector; facts: EventFacts[] }[];
  };
};

function feedback(error: unknown): WalletFormState {
  if (error instanceof MissingRecord) notFound();
  if (error instanceof AccountingError || error instanceof ProviderError)
    return { error: error.message };
  if (error instanceof z.ZodError)
    return {
      error:
        "Some review fields are missing or invalid. Check the amounts, prices, and required selections.",
    };
  console.error(
    "LPStacks wallet operation failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return { error: "Could not complete the request. Please try again." };
}

export async function saveWallet(_: WalletFormState, form: FormData) {
  const user = await requireUser();
  try {
    const value = form.get("address");
    requireFact(
      typeof value === "string" && value.length <= 64,
      "Enter a valid public Base wallet address.",
    );
    await limitOwnerRequest(
      `watch-settings:${user.id}`,
      8,
      60_000,
      "Too many wallet changes. Try again in a minute.",
    );
    await createWalletStore(database()).save(
      user.id,
      value,
      form.get("recent") === "yes",
    );
    revalidatePath("/", "layout");
    return { message: "Base wallet saved." };
  } catch (error) {
    return feedback(error);
  }
}

export async function pauseWallet(form: FormData) {
  const user = await requireUser();
  await createWalletStore(database()).pause(
    user.id,
    form.get("pause") === "yes",
  );
  revalidatePath("/", "layout");
}

export async function ignoreWalletActivity(form: FormData) {
  const user = await requireUser();
  await createWalletStore(database()).setIgnored(
    user.id,
    String(form.get("id") ?? ""),
    form.get("ignore") === "yes",
  );
  revalidatePath("/transactions");
}

export async function reviewSelection(form: FormData) {
  await requireUser();
  const selection = activityIds.safeParse(form.getAll("activity"));
  if (!selection.success)
    redirect("/transactions?view=wallet&selection=invalid");
  redirect(
    `/transactions/review?${new URLSearchParams({ ids: selection.data.join(",") })}`,
  );
}

export async function importWalletActivity(
  _: WalletFormState,
  form: FormData,
): Promise<WalletFormState> {
  const user = await requireUser();
  const db = database();
  try {
    const { rpc } = baseEndpoints();
    requireFact(rpc, "Configure Base RPC on the server to verify imports.");
    const file = form.get("csv");
    const hasFile = file instanceof File && file.size > 0;
    const candidate = form.get("hash");
    const hasHash = typeof candidate === "string" && candidate.trim() !== "";
    requireFact(
      hasFile !== hasHash,
      "Choose a BaseScan CSV or enter one transaction hash.",
    );
    await limitOwnerRequest(
      `wallet-upload:${user.id}`,
      8,
      60_000,
      "Too many imports. Wait a minute and try again.",
    );
    let hashes: string[];
    let invalid = 0;
    let repeated = 0;
    if (hasFile) {
      requireFact(
        file.size <= MAX_CSV_BYTES,
        "Use a CSV no larger than 512 KB.",
      );
      const parsed = csvHashes(await file.text());
      ({ hashes, invalid, duplicates: repeated } = parsed);
    } else {
      const result = hash.safeParse(candidate);
      requireFact(result.success, "Enter a valid Base transaction hash.");
      hashes = [result.data];
    }
    const queued = await createWalletStore(db).queue(
      user.id,
      hashes,
      hasFile ? "CSV" : "HASH",
    );
    const provider = walletProvider(AbortSignal.timeout(32_000));
    await createWalletSync(db, {
      ...provider,
      discover: null,
      classify: classifyPancake,
    })(user.id);
    revalidatePath("/", "layout");
    return {
      message: `${queued.added} queued, ${queued.duplicate + repeated} duplicates, ${invalid} invalid, ${queued.unrelated} already known as unrelated. Verification updates Wallet activity.`,
    };
  } catch (error) {
    return feedback(error);
  }
}

export async function previewWalletReview(
  _: ReviewState,
  form: FormData,
): Promise<ReviewState> {
  const user = await requireUser();
  const db = database();
  const journal = createJournal(db);
  try {
    const fields = fieldsFrom(form);
    const ids = activityIds.parse(form.getAll("activity"));
    const watch = await createWalletStore(db).watch(user.id);
    requireFact(watch, "Save a public Base wallet before reviewing.");
    requireFact(
      field(fields, "confirm") === "yes",
      "Confirm the selected wallet actions belong to this strategy.",
    );
    await limitOwnerRequest(
      `wallet-review:${user.id}`,
      5,
      60_000,
      "Too many wallet previews. Try again in a minute.",
    );
    const cycle = await journal.get(user.id, z.uuid().parse(fields.strategy));
    const rows = await selectedActivity(db, watch, ids);
    requireFact(
      rows.every(
        (row, i) =>
          field(fields, `r${i}Version`) === `${row.id}:${row.revision}`,
      ),
      "Wallet evidence was updated. Reload the review before continuing.",
    );
    // Validate manual resolutions before fetching quotes.
    const groups = walletGroupsFrom(
      cycle,
      watch,
      rows,
      fields,
      rows.map(() => []),
    );
    for (const [i, group] of groups.entries()) {
      const prefix = `r${i}_`;
      const pricing = Object.fromEntries(
        Object.entries(fields).flatMap(([key, v]) =>
          key.startsWith(prefix) ? [[key.slice(prefix.length), v]] : [],
        ),
      );
      const { choices, kept } = priceChoices(
        pricing,
        presets.base,
        user.settings.timezone,
      );
      requireFact(kept.length === 0, "Select a price mode for each asset.");
      group.prices = await collectPrices(
        cycle.market,
        group.at,
        "historical",
        choices,
      );
    }
    const { id, ledger, evaluation } = await journal.previewWallet(
      user.id,
      cycle.id,
      watch,
      groups,
      cycle.journalVersion,
    );
    return {
      preview: {
        id,
        netWealth: evaluation.netWealth,
        outperformance: evaluation.outperformance,
        wallet: ledger.wallet,
        market: cycle.market,
        groups: groups.map(({ facts, prices }) => ({
          hash: facts[0].txHash!,
          prices,
          facts,
        })),
      },
    };
  } catch (error) {
    return feedback(error);
  }
}

export async function postWalletReview(
  _: WalletFormState,
  form: FormData,
): Promise<WalletFormState> {
  const user = await requireUser();
  const db = database();
  let id: string;
  try {
    await limitOwnerRequest(
      `wallet-post:${user.id}`,
      10,
      60_000,
      "Too many posting attempts. Try again in a minute.",
    );
    const { rpc } = walletProvider(AbortSignal.timeout(45_000));
    requireFact(
      rpc,
      "Configure Base RPC on the server to verify finality before posting.",
    );
    id = await createJournal(db).postWallet(
      user.id,
      String(form.get("review") ?? ""),
      verifyWalletReview(db, rpc),
    );
  } catch (error) {
    return feedback(error);
  }
  revalidatePath("/", "layout");
  redirect(`/positions/${id}`);
}
