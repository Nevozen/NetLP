import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { WalletSource, WalletStatus } from "@/generated/prisma/enums";
import { address, hash } from "@/domain/model";
import { requireFact } from "@/domain/values";
import { BASE, ZERO } from "./base-rpc";

export const walletCategory = z.enum(["ALL", "TX", "TOKEN", "NFT"]);
export type WalletCategory = z.infer<typeof walletCategory>;
type Client = Prisma.TransactionClient;
export const watchKey = (ownerId: string) => ({
  ownerId_chainId: { ownerId, chainId: BASE },
});
const pending = ["DETECTED", "CONFIRMING"] satisfies WalletStatus[];

export function walletScope(ownerId: string, watched: string) {
  return { ownerId, chainId: BASE, address: watched };
}

export async function lockWatch(tx: Client, ownerId: string) {
  await tx.$queryRaw`SELECT 1 FROM "WalletWatch" WHERE "ownerId" = ${ownerId} AND "chainId" = ${BASE} FOR UPDATE`;
  return tx.walletWatch.findUnique({ where: watchKey(ownerId) });
}

export async function queueHashes(
  tx: Client,
  scope: ReturnType<typeof walletScope>,
  hashes: string[],
  source: WalletSource,
) {
  if (!hashes.length) return { added: 0, duplicate: 0, unrelated: 0 };
  const items = [...new Set(hashes)];
  const { count } = await tx.walletActivity.createMany({
    data: items.map((txHash) => ({ ...scope, txHash, sources: [source] })),
    skipDuplicates: true,
  });
  const match = { ...scope, txHash: { in: items } };
  await tx.walletActivity.updateMany({
    where: { ...match, NOT: { sources: { has: source } } },
    data: { sources: { push: source } },
  });
  const unrelated =
    source === "ALCHEMY"
      ? 0
      : await tx.walletActivity.count({
          where: { ...match, status: "UNRELATED" },
        });
  return { added: count, duplicate: hashes.length - count, unrelated };
}

export function activityFilter(
  ownerId: string,
  watched: string,
  category: WalletCategory,
  ignored = false,
): Prisma.WalletActivityWhereInput {
  return {
    ...walletScope(ownerId, watched),
    status: { not: "UNRELATED" },
    ignored,
    ...(category === "TX"
      ? { topLevel: true }
      : category === "TOKEN"
        ? { hasTokens: true }
        : category === "NFT"
          ? { hasNfts: true }
          : {}),
  };
}

export const activityOrder: Prisma.WalletActivityOrderByWithRelationInput[] = [
  { occurredAt: { sort: "desc", nulls: "first" } },
  { blockNumber: "desc" },
  { txIndex: "desc" },
  { id: "desc" },
];

export function createWalletStore(db: PrismaClient) {
  return {
    watch: (ownerId: string) =>
      db.walletWatch.findUnique({ where: watchKey(ownerId) }),
    async save(ownerId: string, input: string, recent: boolean) {
      const normalized = address.safeParse(input);
      requireFact(
        normalized.success && normalized.data !== ZERO,
        "Enter a valid public Base wallet address.",
      );
      const watched = normalized.data;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
        const current = await lockWatch(tx, ownerId);
        if (current?.address === watched) return;
        if (!current) {
          await tx.walletWatch.create({
            data: { ownerId, chainId: BASE, address: watched, recent },
          });
        } else {
          await tx.walletWatch.update({
            where: watchKey(ownerId),
            data: {
              address: watched,
              recent,
              enabled: true,
              generation: { increment: 1 },
              startBlock: null,
              nextBlock: null,
              cursor: Prisma.DbNull,
              lease: null,
              leaseUntil: null,
              nextSyncAt: null,
              lastSyncedAt: null,
              issue: null,
            },
          });
        }
      });
    },
    async pause(ownerId: string, paused: boolean) {
      await db.walletWatch.updateMany({
        where: { ownerId, chainId: BASE },
        data: {
          enabled: !paused,
          lease: null,
          leaseUntil: null,
          nextSyncAt: null,
        },
      });
    },
    async queue(ownerId: string, hashes: string[], source: "CSV" | "HASH") {
      const valid = z.array(hash).max(500).parse(hashes);
      return db.$transaction(async (tx) => {
        const watch = await lockWatch(tx, ownerId);
        requireFact(watch, "Save a Base wallet address before importing.");
        const scope = walletScope(ownerId, watch.address);
        requireFact(
          (await tx.walletActivity.count({
            where: { ...scope, status: "DETECTED" },
          })) < 1000,
          "Too many wallet transactions are waiting to be verified. Sync before importing more.",
        );
        return queueHashes(tx, scope, valid, source);
      });
    },
    async setIgnored(ownerId: string, id: string, ignored: boolean) {
      if (!z.uuid().safeParse(id).success) return;
      await db.$transaction(async (tx) => {
        const watch = await lockWatch(tx, ownerId);
        if (!watch) return;
        await tx.walletActivity.updateMany({
          where: {
            ...walletScope(ownerId, watch.address),
            id,
            status: { notIn: ["POSTED", "UNRELATED"] },
          },
          data: { ignored, revision: { increment: 1 } },
        });
      });
    },
    async counts(ownerId: string, watched: string) {
      const grouped = await db.walletActivity.groupBy({
        where: walletScope(ownerId, watched),
        by: ["status"],
        _count: { _all: true },
      });
      const counts = new Map(
        grouped.map((row) => [row.status, row._count._all]),
      );
      return {
        pending: pending.reduce(
          (sum, status) => sum + (counts.get(status) ?? 0),
          0,
        ),
        unrelated: counts.get("UNRELATED") ?? 0,
      };
    },
  };
}
