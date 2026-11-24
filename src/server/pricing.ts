import { isLosslessNumber, type LosslessNumber, parse } from "lossless-json";
import { z } from "zod";
import { mappings } from "@/domain/catalog";
import {
  type Market,
  priceText,
  type PriceVector,
  type Quote,
  timestamp,
  tokens,
} from "@/domain/model";
import { D, QUOTE_NEAR_MS, requireFact } from "@/domain/values";

type Sample = { usd: string; observedAt: string; resolution: string };
type Mode = "historical" | "latest";
export interface PriceProvider {
  historical(slug: string, at: string): Promise<Sample | null>;
  latest(slugs: string[]): Promise<Map<string, Sample>>;
}

const hour = 3_600_000;
const day = hour * 24;
const baseUrl = "https://api.coingecko.com/api/v3";
const observation = z.union([
  z.custom<LosslessNumber>(isLosslessNumber),
  z.string(),
]);
const current = z.record(
  z.string(),
  z
    .object({
      usd: observation.nullish(),
      last_updated_at: observation.nullish(),
    })
    .passthrough(),
);
const history = z.object({
  prices: z.array(z.tuple([observation, observation])).max(2000),
});
const knownSlugs = new Set(Object.values(mappings).map(({ slug }) => slug));

function sample(
  value: { toString: () => string },
  seconds: number,
  resolution: string,
): Sample | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 8.64e15)
    return null;
  const text = value.toString();
  if (text.length > 100 || !/^\d+(\.\d+)?(e[+-]?\d{1,3})?$/i.test(text))
    return null;
  const decimal = new D(text);
  if (decimal.e > 23 || decimal.e < -36) return null;
  const usd = decimal.toFixed();
  if (!decimal.gt(0) || !priceText.safeParse(usd).success) return null;
  return { usd, observedAt: new Date(seconds).toISOString(), resolution };
}

export function coinGecko(
  {
    fetcher = fetch,
    now = Date.now,
    key,
    wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = {} as {
    fetcher?: typeof fetch;
    now?: () => number;
    key?: string;
    wait?: (ms: number) => Promise<void>;
  },
): PriceProvider {
  const cache = new Map<string, { until: number; pending: Promise<unknown> }>();
  async function request<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
    ttl: number,
  ) {
    const target = `${baseUrl}${path}?${new URLSearchParams(params)}`;
    const saved = cache.get(target);
    if (saved && saved.until > now()) return saved.pending as Promise<T | null>;
    const pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetcher(target, {
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(3500),
            headers: key ? { "x-cg-demo-api-key": key } : {},
          });
          if (response.ok) {
            const body = await response.text();
            if (body.length > 1_000_000) return null;
            const checked = schema.safeParse(parse(body));
            return checked.success ? checked.data : null;
          }
          if (response.status < 500 && response.status !== 429) return null;
          if (
            response.status === 429 &&
            Number(response.headers.get("retry-after")) > 1
          )
            return null;
        } catch {
          // A timeout or malformed response never becomes a zero or a spot-price substitute.
        }
        if (attempt === 0) await wait(350);
      }
      return null;
    })();
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(target, { until: now() + ttl, pending });
    if ((await pending) === null && cache.get(target)?.pending === pending) {
      cache.set(target, { until: now() + 30_000, pending });
    }
    return pending;
  }

  return {
    async historical(slug, at) {
      const time = Date.parse(at);
      if (
        !knownSlugs.has(slug) ||
        !Number.isFinite(time) ||
        time > now() ||
        time < now() - 365 * day
      )
        return null;
      const reply = await request(
        `/coins/${slug}/market_chart/range`,
        {
          vs_currency: "usd",
          precision: "full",
          from: String(Math.floor((time - 3 * hour) / 1000)),
          to: String(Math.ceil(Math.min(time + 3 * hour, now()) / 1000)),
        },
        history,
        10 * 60_000,
      );
      const samples = (reply?.prices ?? [])
        .map(([ms, usd]) => ({ ms: Number(ms.toString()), usd }))
        .filter(
          (s) =>
            Number.isSafeInteger(s.ms) &&
            Math.abs(time - s.ms) <= 3 * hour &&
            s.ms <= now(),
        )
        .sort(
          (a, b) =>
            Math.abs(time - a.ms) - Math.abs(time - b.ms) || a.ms - b.ms,
        );
      const nearest = samples[0];
      return nearest
        ? sample(nearest.usd, nearest.ms, "Nearest historical market sample")
        : null;
    },
    async latest(slugs) {
      const ids = [
        ...new Set(slugs.filter((slug) => knownSlugs.has(slug))),
      ].sort();
      const result = new Map<string, Sample>();
      if (!ids.length) return result;
      const reply = await request(
        "/simple/price",
        {
          ids: ids.join(","),
          vs_currencies: "usd",
          precision: "full",
          include_last_updated_at: "true",
        },
        current,
        60_000,
      );
      for (const id of ids) {
        const row = reply?.[id];
        if (!row?.usd || !row.last_updated_at) continue;
        const mark = sample(
          row.usd,
          Number(row.last_updated_at.toString()) * 1000,
          "Latest market quote",
        );
        if (mark) result.set(id, mark);
      }
      return result;
    },
  };
}

export const choiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("AUTO") }),
  z.object({ mode: z.literal("MISSING") }),
  z.object({
    mode: z.literal("MANUAL"),
    usd: priceText.refine(
      (p) => new D(p).gt(0),
      "Enter a positive USD reference price.",
    ),
    source: z
      .string()
      .trim()
      .min(1, "Provide the independent reference source.")
      .max(120),
    reason: z
      .string()
      .trim()
      .min(3, "Provide a manual reference reason.")
      .max(2000),
    observedAt: timestamp.optional(),
  }),
]);
export type PriceChoice = z.infer<typeof choiceSchema>;
let defaultProvider: PriceProvider | undefined;

export async function collectPrices(
  market: Market,
  at: string,
  mode: Mode,
  choices: Record<string, PriceChoice>,
  provider = (defaultProvider ??= coinGecko({
    key: process.env.COINGECKO_DEMO_KEY,
  })),
  now = () => new Date().toISOString(),
): Promise<PriceVector> {
  timestamp.parse(at);
  const assets = tokens(market);
  const autoSlugs = assets.flatMap((asset) =>
    choices[asset.id]?.mode === "AUTO" && mappings[asset.id]
      ? [mappings[asset.id].slug]
      : [],
  );
  const latest =
    mode === "latest" && autoSlugs.length
      ? await provider.latest(autoSlugs)
      : null;
  return Promise.all(
    assets.map(async (asset): Promise<Quote> => {
      const common = { asset: asset.id, requestedAt: at };
      const choice = choiceSchema.parse(
        choices[asset.id] ?? { mode: "MISSING" },
      );
      const mapping = mappings[asset.id];
      if (choice.mode === "MANUAL") {
        requireFact(
          !choice.observedAt || choice.observedAt <= now(),
          "A reference observation cannot be in the future.",
        );
        return {
          ...common,
          usd: choice.usd,
          observedAt: choice.observedAt ?? at,
          fetchedAt: now(),
          source: choice.source,
          quality: "MANUAL",
          resolution: "User-supplied independent reference",
          note: choice.reason,
        };
      }
      if (choice.mode === "AUTO" && mapping) {
        const found =
          mode === "latest"
            ? latest?.get(mapping.slug)
            : await provider.historical(mapping.slug, at);
        if (found) {
          const mismatch =
            Math.abs(Date.parse(found.observedAt) - Date.parse(at)) >
            QUOTE_NEAR_MS;
          return {
            ...common,
            ...found,
            fetchedAt: now(),
            source: "CoinGecko",
            providerAsset: mapping.slug,
            quality: mapping.proxy
              ? "PROXY"
              : mismatch
                ? "APPROXIMATE"
                : "EXACT_OR_NEAR",
            note:
              mapping.proxy ??
              (mismatch
                ? "Market observation is more than 15 minutes from the requested timestamp."
                : undefined),
          };
        }
      }
      return {
        ...common,
        usd: null,
        observedAt: null,
        fetchedAt: now(),
        source: choice.mode === "AUTO" ? "CoinGecko" : "Not provided",
        providerAsset: mapping?.slug,
        resolution: "Unavailable",
        quality: "MISSING",
        note:
          choice.mode === "AUTO"
            ? "No matching market quote. Supply an independent manual price or leave it unresolved."
            : undefined,
      };
    }),
  );
}
