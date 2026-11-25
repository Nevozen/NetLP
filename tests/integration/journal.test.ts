import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EventFacts, type Market, type PriceVector } from "@/domain/model";
import { connectDatabase } from "@/server/db";
import { createJournal, MissingRecord } from "@/server/journal";
import { isolatedDatabase } from "../test-db";

const db = connectDatabase(isolatedDatabase("test"));
const journal = createJournal(db);
const owner = randomUUID();
const other = randomUUID();
const w = `8453:0x${"1".repeat(40)}`;
const c = `8453:0x${"2".repeat(40)}`;
const eth = "8453:native";
const market: Market = {
  chainId: "8453",
  network: "Test chain",
  pair: [
    { id: w, symbol: "WETH", decimals: 18 },
    { id: c, symbol: "cbBTC", decimals: 8 },
  ],
  native: { id: eth, symbol: "ETH", decimals: 18 },
};
const at = (day: number) => `2025-01-0${day}T10:00:00.000Z`;
const quotes = (day: number, spot = "2500"): PriceVector =>
  [
    [w, spot],
    [c, "100000"],
    [eth, spot],
  ].map(([asset, usd]) => ({
    asset,
    usd,
    requestedAt: at(day),
    observedAt: at(day),
    fetchedAt: at(day),
    source: "Fixture",
    resolution: "Fixture",
    quality: "MANUAL",
    note: "Test quote",
  }));
const noGas = { gas: "NONE", costs: [] } as const;
const setup = async (user = owner) =>
  journal.create(
    user,
    randomUUID(),
    market,
    { name: "Integration cycle", protocol: "Test LP" },
    {
      at: at(1),
      facts: {
        kind: "OPENING_ALLOCATION",
        baseline: "PRE_ENTRY_VERIFIED",
        wallet: { [w]: "1" },
        gas: "NONE",
        costs: [],
      },
      prices: quotes(1),
    },
  );
const swap = (amount = "0.4"): EventFacts => ({
  kind: "SWAP",
  purpose: "ENTRY",
  inputs: [{ asset: w, amount }],
  outputs: [{ asset: c, amount: "0.0099" }],
  gas: "NONE",
  costs: [],
});

beforeAll(async () => {
  await db.user.createMany({
    data: [owner, other].map((id) => ({
      id,
      name: "Isolation test",
      email: `${id}@example.test`,
    })),
  });
});
afterAll(() => db.$disconnect());

describe("PostgreSQL journal", () => {
  it("rejects cross-owner reads, exports' data source, drafts, corrections and mutations", async () => {
    const id = await setup();
    await expect(journal.get(other, id)).rejects.toBeInstanceOf(MissingRecord);
    await expect(journal.history(other, id, id)).rejects.toBeInstanceOf(
      MissingRecord,
    );
    await expect(
      journal.saveDraft(other, id, randomUUID(), { notes: "Not mine" }),
    ).rejects.toBeInstanceOf(MissingRecord);
    await expect(
      journal.editMetadata(other, id, { name: "Not mine", protocol: "Test" }),
    ).rejects.toBeInstanceOf(MissingRecord);
    await expect(
      journal.post(other, id, randomUUID(), {
        at: at(2),
        facts: swap(),
        prices: quotes(2),
      }),
    ).rejects.toBeInstanceOf(MissingRecord);
    expect(await journal.list(other)).toEqual([]);
  });

  it("makes retries idempotent and serializes concurrent spending", async () => {
    const id = await setup();
    const command = randomUUID();
    const post = { at: at(2), facts: swap("0.6"), prices: quotes(2) };
    const repeated = await Promise.all([
      journal.post(owner, id, command, post),
      journal.post(owner, id, command, post),
    ]);
    expect(repeated).toEqual([command, command]);
    await expect(
      journal.post(owner, id, command, { ...post, facts: swap("0.5") }),
    ).rejects.toThrow(/different inputs/);
    const next = { at: at(3), facts: swap("0.3"), prices: quotes(3) };
    const raced = await Promise.allSettled([
      journal.post(owner, id, randomUUID(), next),
      journal.post(owner, id, randomUUID(), next),
    ]);
    expect(raced.filter((op) => op.status === "fulfilled")).toHaveLength(1);
    const cycle = await journal.get(owner, id);
    expect(cycle.events).toHaveLength(3);
    expect(cycle.evaluation.quantities.wallet[w]).toBe("0.1");
  });

  it("rolls back prices and accounting on cross-cycle duplicate fees and action IDs", async () => {
    const a = await setup();
    const b = await setup();
    const txHash = `0x${randomUUID().replaceAll("-", "").repeat(2)}`;
    const entry: EventFacts = {
      kind: "GAS_ONLY",
      gas: "RECORDED",
      txHash,
      actionIndex: 0,
      costs: [
        { asset: eth, amount: "0.001", funding: "EXTERNAL", category: "GAS" },
      ],
    };
    await journal.post(owner, a, randomUUID(), {
      at: at(2),
      facts: entry,
      prices: quotes(2),
    });
    await expect(
      journal.post(owner, b, randomUUID(), {
        at: at(2),
        facts: { ...entry, actionIndex: 1 },
        prices: quotes(2),
      }),
    ).rejects.toThrow(/Duplicate/);
    await expect(
      journal.post(owner, b, randomUUID(), {
        at: at(2),
        facts: { ...swap(), txHash, actionIndex: 0 },
        prices: quotes(2),
      }),
    ).rejects.toThrow(/Duplicate/);
    expect(await db.priceSet.count({ where: { strategyId: b } })).toBe(1);
    expect((await journal.get(owner, b)).events).toHaveLength(1);
  });

  it("audits historical corrections, discards drafts only after posting, and freezes the final record", async () => {
    const id = await setup();
    const command = randomUUID();
    await journal.saveDraft(owner, id, command, { amount: "unresolved" });
    const post = { at: at(2), facts: swap(), prices: quotes(2) };
    await journal.post(owner, id, command, post);
    expect(await journal.drafts(owner, id)).toEqual([]);
    const revision = {
      eventId: command,
      version: 1,
      reason: "Correct the receipt reference",
    };
    await expect(
      journal.post(
        owner,
        id,
        randomUUID(),
        { ...post, at: "2025-01-01T00:00:00.000Z", prices: [] },
        revision,
      ),
    ).rejects.toThrow(/opening allocation/);
    expect(await journal.history(owner, id, command)).toHaveLength(1);
    await journal.post(
      owner,
      id,
      randomUUID(),
      { ...post, prices: quotes(2, "2600") },
      revision,
    );
    expect(
      (await journal.history(owner, id, command)).map((r) => r.prices[0].usd),
    ).toEqual(["2600", "2500"]);
    await expect(
      journal.post(owner, id, randomUUID(), post, revision),
    ).rejects.toThrow(/has changed/);
    await journal.post(owner, id, randomUUID(), {
      at: at(3),
      facts: { kind: "CLOSE_STRATEGY", ...noGas, costs: [] },
      prices: quotes(3, "3000"),
    });
    const closed = await journal.get(owner, id);
    expect(closed.evaluation).toMatchObject({
      netWealth: "2790",
      hodl: "3000",
      totalPnl: "290",
      outperformance: "-210",
      executionShortfall: "50",
    });
    const final = await db.finalEvaluation.findUniqueOrThrow({
      where: { strategyId: id },
    });
    expect(final.revisionIds).toEqual(closed.events.map((r) => r.revisionId));
    await expect(
      journal.saveMark(owner, id, at(4), quotes(4, "10000"), randomUUID()),
    ).rejects.toThrow(/frozen/);
    await expect(
      journal.post(owner, id, randomUUID(), {
        ...post,
        at: at(4),
        prices: quotes(4),
      }),
    ).rejects.toThrow(/frozen/);
    expect((await journal.get(owner, id)).evaluation).toEqual(
      closed.evaluation,
    );
  });
});
