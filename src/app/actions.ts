"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { denominations } from "@/domain/catalog";
import { type Amounts, type Market, type PriceVector } from "@/domain/model";
import { AccountingError, requireFact } from "@/domain/values";
import { evaluate } from "@/domain/performance";
import { replay } from "@/domain/ledger";
import { fromLocal, isTimezone } from "@/lib/time";
import { database } from "@/server/db";
import {
  command,
  factsFrom,
  field,
  fieldsFrom,
  type Fields,
  marketFrom,
  metadataFrom,
  priceChoices,
  required,
} from "@/server/form-data";
import { createJournal, MissingRecord } from "@/server/journal";
import { collectPrices } from "@/server/pricing";
import { limitOwnerRequest } from "@/server/request-limit";
import { requireUser } from "@/server/session";

export type FormState = {
  error?: string;
  preview?: {
    prices: PriceVector;
    wallet: Amounts;
    netWealth: string | null;
    shortfall?: string | null;
    bps?: string | null;
    costs?: string | null;
  };
};

function issue(error: unknown): FormState {
  if (error instanceof AccountingError) return { error: error.message };
  if (error instanceof MissingRecord) notFound();
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return {
      error: `${first.path.length ? `${first.path.join(" / ")}: ` : ""}${first.message}`,
    };
  }
  // Do not log provider headers, transaction identifiers, or submitted financial fields.
  console.error(
    "LPStacks form operation failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return { error: "Could not save the request. Try again later." };
}

async function quotes(
  ownerId: string,
  f: Fields,
  m: Market,
  at: string,
  zone: string,
  previous?: PriceVector,
  latest = false,
) {
  const { choices, kept } = priceChoices(f, m, zone);
  if (kept.length) {
    requireFact(
      previous !== undefined &&
        previous.every((quote) => quote.requestedAt === at),
      "When correcting a timestamp, choose a new reference price mode for every asset.",
    );
  }
  if (Object.values(choices).some((choice) => choice.mode === "AUTO")) {
    await limitOwnerRequest(
      `price:${ownerId}`,
      20,
      60_000,
      "Automatic pricing is temporarily rate-limited. Wait a minute or use manual pricing.",
    );
  }
  const vector = await collectPrices(
    m,
    at,
    latest ? "latest" : "historical",
    choices,
  );
  return vector.map((quote) =>
    kept.includes(quote.asset)
      ? (previous?.find((q) => q.asset === quote.asset) ?? quote)
      : quote,
  );
}

function localTimestamp(f: Fields, zone: string) {
  return fromLocal(required(f, "at", "the date and time"), zone);
}

export async function openCycle(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const f = fieldsFrom(form);
  let id: string;
  try {
    const market = marketFrom(f);
    const metadata = metadataFrom(f);
    const at = localTimestamp(f, user.settings.timezone);
    id = command(f);
    const facts = factsFrom(
      { ...f, kind: "OPENING_ALLOCATION" },
      market,
      metadata.protocol,
      id,
    );
    if (f.intent !== "preview")
      requireFact(
        f.independent === "yes",
        "Confirm that this allocation does not overlap a different cycle.",
      );
    const prices = await quotes(user.id, f, market, at, user.settings.timezone);
    if (f.intent === "preview") {
      const ledger = replay(market, [{ id, at, sequence: 1, facts, prices }]);
      return {
        preview: {
          prices,
          wallet: ledger.wallet,
          netWealth: evaluate(market, ledger, at, prices).netWealth,
        },
      };
    }
    await createJournal(database()).create(user.id, id, market, metadata, {
      at,
      facts,
      prices,
    });
  } catch (error) {
    return issue(error);
  }
  revalidatePath("/", "layout");
  redirect(`/positions/${id}`);
}

export async function writeEvent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const f = fieldsFrom(form);
  const strategyId = f.strategyId;
  const journal = createJournal(database());
  let destination = `/positions/${strategyId}`;
  try {
    const cycle = await journal.get(user.id, strategyId);
    const id = command(f);
    const eventId = field(f, "eventId");
    const prior = eventId
      ? cycle.events.find(({ entry }) => entry.id === eventId)
      : undefined;
    if (eventId && !prior) throw new MissingRecord();
    if (f.intent === "draft") {
      requireFact(
        !eventId && f.kind !== "CLOSE_STRATEGY",
        "Only new transaction entries can be saved as drafts.",
      );
      await journal.saveDraft(user.id, cycle.id, id, f);
      destination = `/positions/${cycle.id}?draft=saved`;
    } else {
      const version = Number(f.version);
      const reason = eventId
        ? required(f, "revisionReason", "an audit reason")
        : undefined;
      const correction =
        eventId && reason ? { eventId, version, reason } : undefined;
      const at = prior?.entry.walletOrigin
        ? prior.entry.at
        : localTimestamp(f, user.settings.timezone);
      const facts = factsFrom(
        f,
        cycle.market,
        cycle.protocol,
        prior?.entry.id ?? id,
      );
      const prices = await quotes(
        user.id,
        f,
        cycle.market,
        at,
        user.settings.timezone,
        prior?.entry.prices,
      );
      if (f.intent === "preview") {
        const { line, evaluation, ledger } = await journal.preview(
          user.id,
          cycle.id,
          id,
          { at, facts, prices },
          correction,
        );
        return {
          preview: {
            prices,
            wallet: ledger.wallet,
            netWealth: evaluation.netWealth,
            shortfall: line.swap?.shortfall,
            bps: line.swap?.bps,
            costs: evaluation.operationalCosts,
          },
        };
      }
      await journal.post(
        user.id,
        cycle.id,
        id,
        { at, facts, prices },
        correction,
      );
    }
  } catch (error) {
    return issue(error);
  }
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function updateMark(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const f = fieldsFrom(form);
  const journal = createJournal(database());
  const id = f.strategyId;
  try {
    const cycle = await journal.get(user.id, id);
    requireFact(!cycle.closedAt, "Closing prices are frozen.");
    const latest = f.markMode === "latest";
    const at = latest
      ? new Date().toISOString()
      : localTimestamp(f, user.settings.timezone);
    const prices = await quotes(
      user.id,
      f,
      cycle.market,
      at,
      user.settings.timezone,
      undefined,
      latest,
    );
    if (f.intent === "preview") {
      const entries = cycle.events
        .map(({ entry }) => entry)
        .filter((entry) => entry.at <= at);
      const evalView = evaluate(
        cycle.market,
        replay(cycle.market, entries),
        at,
        prices,
      );
      return {
        preview: {
          prices,
          wallet: evalView.quantities.wallet,
          netWealth: evalView.netWealth,
        },
      };
    }
    requireFact(
      prices.some((q) => q.usd !== null),
      "No usable quotes arrived. Keep the existing mark or enter an independent manual quote.",
    );
    await journal.saveMark(user.id, cycle.id, at, prices, command(f));
  } catch (error) {
    return issue(error);
  }
  revalidatePath("/", "layout");
  redirect(`/positions/${id}`);
}

export async function updateMetadata(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const f = fieldsFrom(form);
  try {
    await createJournal(database()).editMetadata(
      user.id,
      f.strategyId,
      metadataFrom(f),
    );
  } catch (error) {
    return issue(error);
  }
  revalidatePath("/", "layout");
  redirect(`/positions/${f.strategyId}`);
}

export async function setPreferences(form: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({
      timezone: z.string().max(80).refine(isTimezone).optional(),
      theme: z.enum(["light", "dark", "system"]).optional(),
      denomination: z.enum(denominations).optional(),
    })
    .safeParse(fieldsFrom(form));
  if (!parsed.success) return;
  await database().preference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...parsed.data },
    update: parsed.data,
  });
  revalidatePath("/", "layout");
}
