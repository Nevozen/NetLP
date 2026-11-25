import {
  decodeEventLog,
  formatUnits,
  parseAbi,
  toEventSelector,
  type Hex,
} from "viem";
import { z } from "zod";
import { presets } from "@/domain/catalog";
import { address } from "@/domain/model";
import {
  BASE,
  blockTime,
  ProviderError,
  receiptFees,
  type BaseReader,
  type ChainBlock,
  type ChainLog,
} from "./base-rpc";

const transfers = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
]);
const [erc20, erc721, single, batch] = transfers;
const transferTopic = toEventSelector(erc20);
const singleTopic = toEventSelector(single);
const batchTopic = toEventSelector(batch);
const units = z.string().regex(/^\d{1,78}$/);
const transferSchema = z.object({
  contract: address,
  from: address,
  to: address,
  standard: z.enum(["ERC-20", "ERC-721", "ERC-1155"]),
  tokenId: units.optional(),
  units,
  logIndex: z.number().int().nonnegative(),
  item: z.number().int().nonnegative(),
});
export type WalletTransfer = z.infer<typeof transferSchema>;
const MAX_TRANSFERS = 120;

export const evidenceSchema = z.object({
  from: address,
  to: address.nullable(),
  value: units,
  result: z.enum(["success", "reverted"]),
  transfers: z.array(transferSchema).max(MAX_TRANSFERS),
  omittedTransfers: z.number().int().nonnegative(),
  fees: z.object({
    execution: units.nullable(),
    l1: units.nullable(),
    operator: units.nullable(),
    total: units.nullable(),
  }),
});
export type WalletEvidence = z.infer<typeof evidenceSchema>;

export function knownToken(contract: string) {
  return presets.base.pair.find((token) => token.id === `${BASE}:${contract}`);
}

export function showTransfer(transfer: WalletTransfer) {
  if (transfer.standard !== "ERC-20")
    return `${transfer.standard} #${transfer.tokenId} × ${transfer.units}`;
  const token = knownToken(transfer.contract);
  return token
    ? `${formatUnits(BigInt(transfer.units), token.decimals)} ${token.symbol}`
    : `${transfer.units} base units (ERC-20)`;
}

function transferLog(log: ChainLog): WalletTransfer[] {
  const topics = log.topics as [Hex, ...Hex[]];
  const [signature] = topics;
  const padded = /^0x0{24}[a-f0-9]{40}$/;
  const base = { contract: log.address, logIndex: log.logIndex, item: 0 };
  try {
    if (
      signature === transferTopic &&
      padded.test(topics[1]) &&
      padded.test(topics[2])
    ) {
      if (topics.length === 3 && log.data.length === 66) {
        const { args } = decodeEventLog({
          abi: [erc20],
          topics,
          data: log.data,
        });
        return [
          {
            ...base,
            standard: "ERC-20",
            from: args.from.toLowerCase(),
            to: args.to.toLowerCase(),
            units: args.value.toString(),
          },
        ];
      }
      if (topics.length === 4 && log.data === "0x") {
        const { args } = decodeEventLog({
          abi: [erc721],
          topics,
          data: log.data,
        });
        return [
          {
            ...base,
            standard: "ERC-721",
            from: args.from.toLowerCase(),
            to: args.to.toLowerCase(),
            units: "1",
            tokenId: args.tokenId.toString(),
          },
        ];
      }
    }
    if (
      topics.length !== 4 ||
      !topics.slice(1).every((topic) => padded.test(topic))
    )
      return [];
    if (signature === singleTopic && log.data.length === 130) {
      const { args } = decodeEventLog({
        abi: [single],
        topics,
        data: log.data,
      });
      return [
        {
          ...base,
          standard: "ERC-1155",
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
          units: args.value.toString(),
          tokenId: args.id.toString(),
        },
      ];
    }
    if (signature === batchTopic) {
      const { args } = decodeEventLog({ abi: [batch], topics, data: log.data });
      if (args.ids.length !== args.values.length) return [];
      return args.ids.map((id, item) => ({
        ...base,
        standard: "ERC-1155",
        item,
        from: args.from.toLowerCase(),
        to: args.to.toLowerCase(),
        units: args.values[item].toString(),
        tokenId: id.toString(),
      }));
    }
  } catch {
    // Nonstandard contracts can emit the same signature with a different layout.
  }
  return [];
}

export function decodeTransfers(logs: ChainLog[], wallet?: string) {
  return logs.flatMap((log) => {
    if (
      wallet &&
      !log.topics
        .slice(1)
        .some((topic) => topic === `0x${"0".repeat(24)}${wallet.slice(2)}`)
    )
      return [];
    return transferLog(log).filter(
      (t) => !wallet || t.from === wallet || t.to === wallet,
    );
  });
}

export async function verifyActivity(
  rpc: BaseReader,
  wallet: string,
  txHash: string,
  finalized: bigint,
  blockAt: (n: bigint) => Promise<ChainBlock> = rpc.block,
) {
  const [tx, receipt] = await Promise.all([
    rpc.transaction(txHash),
    rpc.receipt(txHash),
  ]);
  if (
    !tx ||
    !receipt ||
    tx.blockHash !== receipt.blockHash ||
    tx.blockNumber !== receipt.blockNumber ||
    tx.transactionIndex !== receipt.transactionIndex
  )
    return null;
  if (
    tx.hash !== txHash ||
    receipt.transactionHash !== txHash ||
    receipt.from !== tx.from ||
    receipt.to !== tx.to
  )
    throw new ProviderError("INVALID");

  const block = await blockAt(receipt.blockNumber);
  if (block.number !== receipt.blockNumber || block.hash !== receipt.blockHash)
    return null;
  const seen = new Set<number>();
  for (const log of receipt.logs) {
    if (
      log.removed ||
      log.blockHash !== block.hash ||
      log.transactionHash !== txHash ||
      log.transactionIndex !== receipt.transactionIndex ||
      seen.has(log.logIndex)
    )
      throw new ProviderError("INVALID");
    seen.add(log.logIndex);
  }
  receipt.logs.sort((a, b) => a.logIndex - b.logIndex);
  const topLevel = tx.from === wallet || tx.to === wallet;
  const walletTransfers =
    receipt.status === "0x1" ? decodeTransfers(receipt.logs, wallet) : [];
  if (!topLevel && walletTransfers.length === 0) return "UNRELATED" as const;
  const evidence: WalletEvidence = {
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    result: receipt.status === "0x1" ? "success" : "reverted",
    transfers: walletTransfers.slice(0, MAX_TRANSFERS),
    omittedTransfers: Math.max(0, walletTransfers.length - MAX_TRANSFERS),
    fees: await receiptFees(rpc, tx, receipt, block),
  };
  return {
    wallet,
    tx,
    receipt,
    block,
    evidence,
    at: blockTime(block),
    finalized: block.number <= finalized,
    topLevel,
    hasTokens: walletTransfers.some((t) => t.standard === "ERC-20"),
    hasNfts: walletTransfers.some((t) => t.standard !== "ERC-20"),
  };
}

export type VerifiedActivity = Exclude<
  Awaited<ReturnType<typeof verifyActivity>>,
  null | "UNRELATED"
>;
