import { expect, it, vi } from "vitest";
import { presets } from "@/domain/catalog";
import { fromLocal, localInput } from "@/lib/time";
import { coinGecko, collectPrices } from "@/server/pricing";

const market = presets.base;
const at = "2025-04-01T12:00:00.000Z";
const now = () => Date.parse("2025-04-01T18:00:00.000Z");
const [weth, btc] = market.pair;

it("batches spot requests, preserves decimal literals, discloses the native proxy, and caches", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(`{
    "l2-standard-bridged-weth-base":{"usd":1234.123456789012345678,"last_updated_at":${Date.parse(at) / 1000}},
    "coinbase-wrapped-btc":{"usd":100000,"last_updated_at":${Date.parse(at) / 1000}},
    "ethereum":{"usd":1235.567,"last_updated_at":${Date.parse(at) / 1000}}
  }`),
  );
  const provider = coinGecko({ fetcher, now });
  const choices = {
    [weth.id]: { mode: "AUTO" },
    [btc.id]: { mode: "AUTO" },
    [market.native.id]: { mode: "AUTO" },
  } as const;
  const vector = await collectPrices(market, at, "latest", choices, provider);
  expect(vector).toMatchObject([
    {
      usd: "1234.123456789012345678",
      observedAt: at,
      quality: "EXACT_OR_NEAR",
    },
    { usd: "100000", quality: "EXACT_OR_NEAR" },
    {
      usd: "1235.567",
      quality: "PROXY",
      note: expect.stringContaining("Base native ETH"),
    },
  ]);
  await collectPrices(market, at, "latest", choices, provider);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.flat().map(String).join(" ")).toContain(
    "include_last_updated_at=true",
  );
});

it("uses a nearest historical observation with provenance, not today's price", async () => {
  const nearest = Date.parse(at) - 20 * 60_000;
  const fetcher = vi.fn(
    async () =>
      new Response(
        `{"prices":[[${nearest - 3600000},99],[${nearest},2500.10001]]}`,
      ),
  );
  const result = await collectPrices(
    market,
    at,
    "historical",
    { [weth.id]: { mode: "AUTO" } },
    coinGecko({ fetcher, now }),
  );
  expect(result[0]).toMatchObject({
    quality: "APPROXIMATE",
    usd: "2500.10001",
    requestedAt: at,
    observedAt: new Date(nearest).toISOString(),
  });
  expect(fetcher.mock.calls.flat().map(String).join(" ")).toContain(
    "/market_chart/range",
  );
  expect(result[1].usd).toBeNull();
});

it("survives provider throttling and requires provenance for manual corrections", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response("", { status: 429, headers: { "retry-after": "10" } }),
  );
  const provider = coinGecko({ fetcher, now });
  const result = await collectPrices(
    market,
    at,
    "historical",
    {
      [weth.id]: { mode: "AUTO" },
      [btc.id]: {
        mode: "MANUAL",
        usd: "100000",
        source: "Independent market",
        reason: "Provider offline",
      },
    },
    provider,
  );
  expect(result).toMatchObject([
    { usd: null, quality: "MISSING" },
    { usd: "100000", quality: "MANUAL", observedAt: at },
    { usd: null },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("stores local journal dates in UTC without guessing an ambiguous clock reading", () => {
  const local = "2025-01-02T08:09:10.123";
  expect(fromLocal(local, "Asia/Jakarta")).toBe("2025-01-02T01:09:10.123Z");
  expect(localInput("2025-01-02T01:09:10.123Z", "Asia/Jakarta")).toBe(local);
  expect(() => fromLocal("2025-11-02T01:30", "America/New_York")).toThrow(
    /ambiguous/,
  );
});
