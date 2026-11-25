import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";
import { z } from "zod";
import { address, hash } from "@/domain/model";

export const BASE = "8453";
export const ZERO = `0x${"0".repeat(40)}`;
const ALCHEMY = "base-mainnet.g.alchemy.com";
const MAX_RESPONSE = 2_000_000;
const bytes = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})*$/i)
  .transform((v) => v.toLowerCase() as Hex);
const hexQuantity = z
  .string()
  .regex(/^0x[0-9a-f]{1,64}$/i)
  .transform((v) => BigInt(v));
const index = hexQuantity.refine((v) => v <= 2_147_483_647n).transform(Number);

export class ProviderError extends Error {
  constructor(
    readonly kind: "RATE_LIMIT" | "CURSOR" | "CALL" | "INVALID" | "UNAVAILABLE",
  ) {
    super(
      {
        RATE_LIMIT: "Base provider rate limit reached. Sync will retry.",
        CURSOR: "The provider cursor expired. Sync will resume the same range.",
        CALL: "Historical contract data is unavailable.",
        INVALID: "The Base provider returned invalid or incomplete data.",
        UNAVAILABLE: "The Base provider is unavailable. Sync will retry.",
      }[kind],
    );
  }
}

export function checked<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError("INVALID");
  return parsed.data;
}

const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string().max(2000) })
    .optional(),
});

let alchemySlot = 0;

async function rpcBody(response: Response) {
  if (response.status === 429) throw new ProviderError("RATE_LIMIT");
  if (!response.ok || !response.body) throw new ProviderError("UNAVAILABLE");
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE)
    throw new ProviderError("INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE) {
      void reader.cancel().catch(() => {});
      throw new ProviderError("INVALID");
    }
    body += decoder.decode(value, { stream: true });
  }
  return JSON.parse(body + decoder.decode()) as unknown;
}

export function rpcTransport(endpoint: URL, parentSignal?: AbortSignal) {
  const alchemy = endpoint.hostname === ALCHEMY;
  return async (method: string, params: readonly unknown[] = []) => {
    try {
      if (alchemy) {
        const now = Date.now();
        const scheduled = Math.max(now, alchemySlot);
        if (scheduled - now > 3000) throw new ProviderError("RATE_LIMIT");
        alchemySlot =
          scheduled + (method === "alchemy_getAssetTransfers" ? 450 : 150);
        if (scheduled > now)
          await new Promise((resolve) => setTimeout(resolve, scheduled - now));
      }
      const timeout = AbortSignal.timeout(5000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        redirect: "error",
        signal: parentSignal
          ? AbortSignal.any([timeout, parentSignal])
          : timeout,
      });
      const packet = checked(envelope, await rpcBody(response));
      if (packet.error) {
        const { code, message } = packet.error;
        if (
          code === 429 ||
          /rate limit|compute unit|too many requests/i.test(message)
        )
          throw new ProviderError("RATE_LIMIT");
        if (
          method === "alchemy_getAssetTransfers" &&
          /page.?key|cursor/i.test(message)
        )
          throw new ProviderError("CURSOR");
        if (
          method === "eth_call" &&
          (code === 3 || /revert|historic|missing trie|pruned/i.test(message))
        )
          throw new ProviderError("CALL");
        throw new ProviderError("UNAVAILABLE");
      }
      if (packet.result === undefined) throw new ProviderError("INVALID");
      return packet.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("UNAVAILABLE");
    }
  };
}

export function baseEndpoints() {
  const key = process.env.ALCHEMY_API_KEY?.trim();
  const indexer =
    key && /^[a-zA-Z0-9_-]{1,128}$/.test(key)
      ? new URL(`https://${ALCHEMY}/v2/${key}`)
      : null;
  const setting = process.env.BASE_RPC_URL?.trim();
  if (!setting) return { indexer, rpc: indexer };
  try {
    const rpc = new URL(setting);
    if (
      rpc.username ||
      rpc.password ||
      rpc.hash ||
      (rpc.protocol !== "https:" &&
        !(
          rpc.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname)
        ))
    )
      return { indexer, rpc: null };
    return { indexer, rpc };
  } catch {
    return { indexer, rpc: null };
  }
}

const logSchema = z.object({
  address,
  topics: z.array(hash).max(4),
  data: bytes,
  logIndex: index,
  transactionIndex: index,
  transactionHash: hash,
  blockHash: hash,
  removed: z.boolean().optional(),
});
const txSchema = z.object({
  hash,
  from: address,
  to: address.nullable(),
  value: hexQuantity,
  input: bytes,
  blockHash: hash.nullable(),
  blockNumber: hexQuantity.nullable(),
  transactionIndex: index.nullable(),
  type: hexQuantity,
});
const receiptSchema = z.object({
  transactionHash: hash,
  from: address,
  to: address.nullable(),
  blockHash: hash,
  blockNumber: hexQuantity,
  transactionIndex: index,
  status: z.enum(["0x0", "0x1"]),
  gasUsed: hexQuantity.optional(),
  effectiveGasPrice: hexQuantity.optional(),
  l1Fee: hexQuantity.nullish(),
  operatorFeeScalar: hexQuantity.nullish(),
  operatorFeeConstant: hexQuantity.nullish(),
  logs: z.array(logSchema).max(2048),
});
const blockSchema = z.object({
  number: hexQuantity,
  hash,
  timestamp: hexQuantity,
  timestampMs: hexQuantity.nullish(),
});
export type ChainLog = z.infer<typeof logSchema>;
export type ChainTx = z.infer<typeof txSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type ChainBlock = z.infer<typeof blockSchema>;
export const blockHex = (block: bigint) => `0x${block.toString(16)}`;

export function baseReader(request: ReturnType<typeof rpcTransport>) {
  return {
    async assertChain() {
      if (checked(hexQuantity, await request("eth_chainId")) !== BigInt(BASE))
        throw new ProviderError("INVALID");
    },
    async block(block: "latest" | "finalized" | bigint) {
      const data = await request("eth_getBlockByNumber", [
        typeof block === "bigint" ? blockHex(block) : block,
        false,
      ]);
      return checked(blockSchema, data);
    },
    async transaction(txHash: string) {
      return checked(
        txSchema.nullable(),
        await request("eth_getTransactionByHash", [txHash]),
      );
    },
    async receipt(txHash: string) {
      return checked(
        receiptSchema.nullable(),
        await request("eth_getTransactionReceipt", [txHash]),
      );
    },
    async call(to: string, data: Hex, number: bigint) {
      return checked(
        bytes,
        await request("eth_call", [{ to, data }, blockHex(number)]),
      );
    },
    async blockLogs(blockHash: string, addresses: string[]) {
      return checked(
        z.array(logSchema).max(2048),
        await request("eth_getLogs", [
          {
            blockHash,
            address: addresses,
          },
        ]),
      );
    },
  };
}

export type BaseReader = ReturnType<typeof baseReader>;
const ISTHMUS = 1746806401n;
const JOVIAN = 1764691201n;
const l1Block = "0x4200000000000000000000000000000000000015";
const feesAbi = parseAbi([
  "function operatorFeeScalar() view returns (uint32)",
  "function operatorFeeConstant() view returns (uint64)",
]);

export function operatorFee(
  gas: bigint,
  time: bigint,
  scalar: bigint,
  constant: bigint,
) {
  if (time < ISTHMUS) return 0n;
  return (
    (time < JOVIAN ? (gas * scalar) / 1_000_000n : gas * scalar * 100n) +
    constant
  );
}

export async function receiptFees(
  rpc: BaseReader,
  tx: ChainTx,
  receipt: Receipt,
  block: ChainBlock,
) {
  const { gasUsed, effectiveGasPrice, l1Fee } = receipt;
  const execution =
    gasUsed != null && effectiveGasPrice != null
      ? gasUsed * effectiveGasPrice
      : null;
  const deposit = tx.type === 0x7en;
  let operator: bigint | null =
    block.timestamp < ISTHMUS || deposit ? 0n : null;
  if (operator === null && gasUsed != null) {
    try {
      const scalar =
        receipt.operatorFeeScalar ??
        BigInt(
          decodeFunctionResult({
            abi: feesAbi,
            functionName: "operatorFeeScalar",
            data: await rpc.call(
              l1Block,
              encodeFunctionData({
                abi: feesAbi,
                functionName: "operatorFeeScalar",
              }),
              block.number,
            ),
          }),
        );
      const constant =
        receipt.operatorFeeConstant ??
        decodeFunctionResult({
          abi: feesAbi,
          functionName: "operatorFeeConstant",
          data: await rpc.call(
            l1Block,
            encodeFunctionData({
              abi: feesAbi,
              functionName: "operatorFeeConstant",
            }),
            block.number,
          ),
        });
      operator = operatorFee(gasUsed, block.timestamp, scalar, constant);
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "RATE_LIMIT")
        throw error;
    }
  }
  return {
    execution: execution?.toString() ?? null,
    l1: l1Fee?.toString() ?? null,
    operator: operator?.toString() ?? null,
    total:
      !deposit && execution != null && l1Fee != null && operator != null
        ? (execution + l1Fee + operator).toString()
        : null,
  };
}

export function blockTime(block: ChainBlock) {
  const ms = block.timestampMs ?? block.timestamp * 1000n;
  if (ms / 1000n !== block.timestamp || ms > 8_640_000_000_000_000n)
    throw new ProviderError("INVALID");
  return new Date(Number(ms));
}
