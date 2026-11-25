import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { connectDatabase } from "@/server/db";
import { ProviderError, type BaseReader } from "@/server/onchain/base-rpc";
import { createWalletStore, walletScope } from "@/server/onchain/wallet-store";
import { createWalletSync } from "@/server/onchain/wallet-sync";
import { isolatedDatabase } from "../test-db";

const db = connectDatabase(isolatedDatabase("test"));
const store = createWalletStore(db);
const wallet = `0x${"a".repeat(40)}`;
const receiver = `0x${"b".repeat(40)}`;
const txHash = `0x${"c".repeat(64)}`;
const blockHash = `0x${"f".repeat(64)}`;
const setup = async () => {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: "Wallet fixture", email: `${id}@example.test` },
  });
  await store.save(id, wallet, true);
  return id;
};
const makeRpc = () => {
  const transaction = {
    hash: txHash,
    from: wallet,
    to: receiver,
    value: 42n,
    input: "0x" as const,
    blockHash,
    blockNumber: 998n,
    transactionIndex: 3,
    type: 2n,
  };
  return {
    assertChain: vi.fn(async () => {}),
    block: vi.fn(async (block: "latest" | "finalized" | bigint) => ({
      number:
        typeof block === "bigint" ? block : block === "latest" ? 1000n : 999n,
      hash: blockHash,
      timestamp: 1740000000n,
    })),
    transaction: vi.fn(async () => transaction),
    receipt: vi.fn(async () => ({
      ...transaction,
      transactionHash: txHash,
      status: "0x1" as const,
      logs: [],
      gasUsed: 21_000n,
      effectiveGasPrice: 9n,
      l1Fee: 100n,
    })),
    call: vi.fn<BaseReader["call"]>(),
    blockLogs: vi.fn<BaseReader["blockLogs"]>(),
  } satisfies BaseReader;
};
afterAll(() => db.$disconnect());

it("keeps one receipt across imports, scopes by owner/address, and excludes unrelated results", async () => {
  const owner = await setup();
  const other = await setup();
  const rpc = makeRpc();
  const discover = vi.fn(async () => ({
    hashes: [txHash],
    pageKey: undefined,
  }));
  const sync = createWalletSync(db, { rpc, discover });
  expect(await store.queue(owner, [txHash], "CSV")).toMatchObject({ added: 1 });
  expect(await store.queue(owner, [txHash], "HASH")).toMatchObject({
    duplicate: 1,
  });
  await Promise.all([sync(owner), sync(owner)]);
  expect(rpc.assertChain).toHaveBeenCalledTimes(1);
  expect(discover).toHaveBeenCalledTimes(2);
  const scope = walletScope(owner, wallet);
  const items = await db.walletActivity.findMany({ where: scope });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    status: "ACTIVITY_ONLY",
    topLevel: true,
    sources: ["CSV", "HASH", "ALCHEMY"],
    evidence: {
      from: wallet,
      to: receiver,
      value: "42",
      fees: { total: "189100" },
    },
  });
  await store.setIgnored(other, items[0].id, true);
  expect(
    await db.walletActivity.findUnique({ where: { id: items[0].id } }),
  ).toMatchObject({ ignored: false });
  expect(
    await db.walletActivity.count({ where: walletScope(other, wallet) }),
  ).toBe(0);
  await store.save(owner, `0x${"d".repeat(40)}`, false);
  expect(await store.watch(owner)).toMatchObject({
    startBlock: null,
    nextBlock: null,
    generation: 2,
  });
  await store.queue(owner, [txHash], "HASH");
  await store.pause(owner, true);
  await sync(owner);
  expect(discover).toHaveBeenCalledTimes(2);
  const watch = (await store.watch(owner))!;
  expect(await store.counts(owner, watch.address)).toEqual({
    pending: 0,
    unrelated: 1,
  });
});

it("retries the same range on rate limit or expired pagination without losing candidates", async () => {
  const owner = await setup();
  const rpc = makeRpc();
  const discover = vi
    .fn()
    .mockResolvedValueOnce({ hashes: [txHash], pageKey: "resume" })
    .mockRejectedValueOnce(new ProviderError("RATE_LIMIT"))
    .mockRejectedValueOnce(new ProviderError("RATE_LIMIT"))
    .mockRejectedValueOnce(new ProviderError("CURSOR"))
    .mockResolvedValue({ hashes: [txHash] });
  let now = Date.now();
  const sync = createWalletSync(db, { rpc, discover }, () => new Date(now));
  await sync(owner);
  expect(await store.watch(owner)).toMatchObject({
    nextBlock: 0n,
    cursor: { pageKey: "resume" },
    issue: expect.stringContaining("rate limit"),
  });
  expect(await store.counts(owner, wallet)).toMatchObject({ pending: 1 });
  now += 121_000;
  await sync(owner);
  expect(await store.watch(owner)).toMatchObject({
    nextBlock: 0n,
    syncFailures: 2,
    nextSyncAt: new Date(now + 240_000),
    cursor: { pageKey: "resume" },
  });
  now += 65_000;
  await sync(owner);
  expect(discover).toHaveBeenCalledTimes(3);
  now += 176_000;
  await sync(owner);
  expect(await store.watch(owner)).toMatchObject({
    nextBlock: 0n,
    cursor: { from: "0", to: "1000", direction: "out" },
  });
  now += 16_000;
  await sync(owner);
  expect(await store.watch(owner)).toMatchObject({
    nextBlock: 1001n,
    cursor: null,
    issue: null,
    syncFailures: 0,
  });
  expect(
    await db.walletActivity.count({ where: walletScope(owner, wallet) }),
  ).toBe(1);
});
