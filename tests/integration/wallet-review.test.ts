import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { presets } from "@/domain/catalog";
import { type PriceVector } from "@/domain/model";
import { connectDatabase } from "@/server/db";
import { createJournal, MissingRecord } from "@/server/journal";
import { type BaseReader } from "@/server/onchain/base-rpc";
import {
  verifyWalletReview,
  walletGroupsFrom,
} from "@/server/onchain/wallet-review";
import { createWalletStore, walletScope } from "@/server/onchain/wallet-store";
import { isolatedDatabase } from "../test-db";

const db = connectDatabase(isolatedDatabase("test"));
const journal = createJournal(db);
const store = createWalletStore(db);
const market = presets.base;
const [weth, btc] = market.pair.map((t) => t.id);
const wallet = `0x${"a".repeat(40)}`;
const pool = `0x${"b".repeat(40)}`;
const blockHash = `0x${"c".repeat(64)}`;
const at = (day: number) => `2025-01-0${day}T00:00:00.000Z`;
const prices = (day: number): PriceVector =>
  [weth, btc, market.native.id].map((asset) => ({
    asset,
    usd: asset === btc ? "100000" : "2500",
    requestedAt: at(day),
    observedAt: at(day),
    fetchedAt: at(day),
    source: "Fixture",
    resolution: "Test",
    quality: "MANUAL",
    note: "Fixture market observation",
  }));
const setup = async () => {
  const owner = randomUUID();
  await db.user.create({
    data: { id: owner, name: "Review fixture", email: `${owner}@example.test` },
  });
  await store.save(owner, wallet, true);
  const id = await journal.create(
    owner,
    randomUUID(),
    market,
    { name: "Fixture", protocol: "PancakeSwap v3", walletAddress: wallet },
    {
      at: at(1),
      prices: prices(1),
      facts: {
        kind: "OPENING_ALLOCATION",
        baseline: "PRE_ENTRY_VERIFIED",
        wallet: { [weth]: "0.4" },
        gas: "NONE",
        costs: [],
      },
    },
  );
  return { owner, id, watch: (await store.watch(owner))! };
};
const seed = (
  owner: string,
  day: number,
  index: number,
  paid: [string, string],
  received: [string, string],
) =>
  db.walletActivity.create({
    data: {
      ...walletScope(owner, wallet),
      txHash: `0x${index.toString(16).padStart(64, "a")}`,
      sources: ["ALCHEMY", "HASH"],
      status: "READY",
      revision: 1,
      occurredAt: new Date(at(day)),
      blockNumber: 100n + BigInt(day),
      blockHash,
      txIndex: index,
      evidence: {
        from: wallet,
        to: pool,
        result: "success",
        value: "0",
        transfers: [],
        omittedTransfers: 0,
        fees: {
          execution: "70000000000000",
          l1: "10000000000000",
          operator: "0",
          total: "80000000000000",
        },
      },
      draft: {
        version: 1,
        actions: [{ index, kind: "SWAP", paid, received, pool }],
      },
    },
  });
const reviewFields = {
  confirm: "yes",
  r0funding: "EXTERNAL",
  r0a0purpose: "ENTRY",
  r1funding: "EXTERNAL",
  r1a0purpose: "EXIT",
};
const finalCheck = async () => {};
const version = async (owner: string, id: string) =>
  (await journal.get(owner, id)).journalVersion;
afterAll(() => db.$disconnect());

it("reconciles the $989.80 example and stores the same price/evidence through idempotent batch posting", async () => {
  const { owner, id, watch } = await setup();
  const row = await seed(owner, 2, 1, ["0.4", "0"], ["0", "0.0099"]);
  const groups = walletGroupsFrom(
    await journal.get(owner, id),
    watch,
    [row],
    reviewFields,
    [prices(2)],
  );
  const preview = await journal.previewWallet(
    owner,
    id,
    watch,
    groups,
    await version(owner, id),
  );
  expect(preview.evaluation).toMatchObject({
    netWealth: "989.8",
    outperformance: "-10.2",
    executionShortfall: "10",
    networkHistorical: "0.2",
  });
  const results = await Promise.all([
    journal.postWallet(owner, preview.id, finalCheck),
    journal.postWallet(owner, preview.id, finalCheck),
  ]);
  expect(results).toEqual([id, id]);
  const cycle = await journal.get(owner, id);
  expect(cycle.events).toHaveLength(2);
  const post = cycle.events[1].entry;
  expect(post.walletOrigin).toMatchObject({
    activityId: row.id,
    blockNumber: "102",
    blockHash,
    txIndex: 1,
  });
  expect(cycle.evaluation).toEqual(preview.evaluation);
  const { owner: another } = await setup();
  await expect(
    journal.postWallet(another, preview.id, finalCheck),
  ).rejects.toBeInstanceOf(MissingRecord);
  await expect(
    journal.post(owner, id, randomUUID(), {
      at: at(3),
      facts: { ...post.facts, actionIndex: 7, gas: "NONE", costs: [] },
      prices: prices(3),
    }),
  ).rejects.toThrow(/receipt group/);
});

it("orders same-block transactions by coordinates and keeps one fee per receipt", async () => {
  const { owner, id, watch } = await setup();
  const first = await seed(owner, 2, 1, ["0.4", "0"], ["0", "0.0099"]);
  const last = await seed(owner, 2, 5, ["0", "0.0099"], ["0.39", "0"]);
  const group = walletGroupsFrom(
    await journal.get(owner, id),
    watch,
    [first, last],
    reviewFields,
    [prices(2), prices(2)],
  );
  const preview = await journal.previewWallet(
    owner,
    id,
    watch,
    group.reverse(),
    await version(owner, id),
  );
  await journal.postWallet(owner, preview.id, finalCheck);
  const cycle = await journal.get(owner, id);
  expect(cycle.events.slice(1).map((e) => e.entry.facts.txHash)).toEqual([
    first.txHash,
    last.txHash,
  ]);
  expect(cycle.ledger.wallet[weth]).toBe("0.39");
  expect(cycle.evaluation.networkHistorical).toBe("0.4");
});

it("shares one gas charge and one quote set across actions, then freezes explicit closure", async () => {
  const { owner, id, watch } = await setup();
  const seeded = await seed(owner, 2, 1, ["0.4", "0"], ["0", "0.0099"]);
  const row = await db.walletActivity.update({
    where: { id: seeded.id },
    data: {
      draft: {
        version: 1,
        actions: [
          {
            index: 5,
            kind: "SWAP",
            pool,
            paid: ["0.4", "0"],
            received: ["0", "0.0099"],
          },
          {
            index: 8,
            kind: "SWAP",
            pool,
            paid: ["0", "0.0099"],
            received: ["0.39", "0"],
          },
        ],
      },
    },
  });
  const cycle = await journal.get(owner, id);
  const groups = walletGroupsFrom(
    cycle,
    watch,
    [row],
    { ...reviewFields, r0a1purpose: "EXIT" },
    [prices(2)],
  );
  const preview = await journal.previewWallet(
    owner,
    id,
    watch,
    groups,
    cycle.journalVersion,
  );
  await journal.postWallet(owner, preview.id, finalCheck);
  const open = await journal.get(owner, id);
  expect(open.closedAt).toBeNull();
  expect(open.events.slice(1).map(({ entry }) => entry.facts.gas)).toEqual([
    "RECORDED",
    "SHARED",
  ]);
  expect(open.events[1].priceSetId).toBe(open.events[2].priceSetId);
  expect(open.evaluation).toMatchObject({
    netWealth: "974.8",
    networkHistorical: "0.2",
  });
  await journal.post(owner, id, randomUUID(), {
    at: at(2),
    facts: { kind: "CLOSE_STRATEGY", gas: "NONE", costs: [] },
    prices: prices(2),
  });
  const closed = await journal.get(owner, id);
  expect(closed.mark.type).toBe("FROZEN");
  expect(closed.evaluation.netWealth).toBe(open.evaluation.netWealth);
});

it("invalidates reorged evidence and rejects stale reviews with no partial write", async () => {
  const { owner, id, watch } = await setup();
  const first = await seed(owner, 2, 1, ["0.4", "0"], ["0", "0.0099"]);
  const last = await seed(owner, 3, 5, ["0", "0.0099"], ["0.39", "0"]);
  const groups = walletGroupsFrom(
    await journal.get(owner, id),
    watch,
    [first, last],
    reviewFields,
    [prices(2), prices(3)],
  );
  const review = await journal.previewWallet(
    owner,
    id,
    watch,
    groups,
    await version(owner, id),
  );
  const result = (n: bigint, hash = blockHash) => ({
    number: n,
    hash,
    timestamp: 1730000000n,
  });
  const rpc: BaseReader = {
    assertChain: async () => {},
    receipt: async (transactionHash) =>
      transactionHash === first.txHash
        ? {
            transactionHash,
            from: wallet,
            to: pool,
            blockHash,
            blockNumber: 102n,
            transactionIndex: 1,
            status: "0x1",
            logs: [],
          }
        : null,
    block: async (n) => result(typeof n === "bigint" ? n : 110n),
    transaction: async () => null,
    call: async () => "0x",
    blockLogs: async () => [],
  };
  await expect(
    journal.postWallet(owner, review.id, verifyWalletReview(db, rpc)),
  ).rejects.toThrow(/Base evidence changed/);
  expect((await journal.get(owner, id)).events).toHaveLength(1);
  expect(
    await db.walletActivity.findUnique({ where: { id: last.id } }),
  ).toMatchObject({ status: "DETECTED", revision: 2 });
  await expect(
    journal.postWallet(owner, review.id, finalCheck),
  ).rejects.toThrow(/Wallet evidence changed/);
  expect(
    await db.walletActivity.findUnique({ where: { id: first.id } }),
  ).toMatchObject({ status: "READY", postedEventIds: [] });
});

it("refuses a receipt hash already posted manually even if the action index is different", async () => {
  const { owner, id, watch } = await setup();
  const row = await seed(owner, 2, 1, ["0.4", "0"], ["0", "0.0099"]);
  const groups = walletGroupsFrom(
    await journal.get(owner, id),
    watch,
    [row],
    reviewFields,
    [prices(2)],
  );
  await journal.post(owner, id, randomUUID(), {
    at: at(2),
    facts: { ...groups[0].facts[0], actionIndex: 9 },
    prices: prices(2),
  });
  await expect(
    journal.previewWallet(owner, id, watch, groups, await version(owner, id)),
  ).rejects.toThrow(/already in your journal/);
});
