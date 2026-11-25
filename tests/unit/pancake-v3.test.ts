import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  parseAbiParameters,
  toEventSelector,
  type Hex,
} from "viem";
import {
  decodeTransfers,
  type VerifiedActivity,
} from "@/server/onchain/activity";
import {
  ProviderError,
  ZERO,
  type BaseReader,
  type ChainLog,
} from "@/server/onchain/base-rpc";
import {
  CBBTC,
  FACTORY,
  MANAGER,
  WETH,
  factoryAbi,
  managerAbi,
  poolAbi,
} from "@/server/onchain/pancake-contracts";
import { classifyPancake } from "@/server/onchain/pancake-v3";
import {
  liquidityAmounts,
  tickSqrt,
  unrealizedFee,
} from "@/server/onchain/position";

const wallet = `0x${"a".repeat(40)}` as const;
const pool = `0x${"b".repeat(40)}` as const;
const router = "0x1b81d678ffb9c0263b24a97847620c99d213eb14";
const hash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;
const W = 10n ** 18n;
const B = 10n ** 8n;
const Q = 1n << 128n;
const word = (v: string | bigint): Hex =>
  `0x${(typeof v === "string" ? v.slice(2) : v.toString(16)).padStart(64, "0")}`;
const int = (v: number) => word(BigInt.asUintN(256, BigInt(v)));
const log = (
  address: string,
  logIndex: number,
  signature: string,
  indexed: Hex[],
  data: Hex,
): ChainLog => ({
  address,
  logIndex,
  topics: [toEventSelector(signature), ...indexed],
  data,
  blockHash,
  transactionHash: hash,
  transactionIndex: 3,
});
const encode = encodeAbiParameters;
const erc = (
  token: string,
  index: number,
  from: string,
  to: string,
  value: bigint,
) =>
  log(
    token,
    index,
    "Transfer(address,address,uint256)",
    [word(from), word(to)],
    word(value),
  );
const nft = (index: number, from: string, to: string) =>
  log(
    MANAGER,
    index,
    "Transfer(address,address,uint256)",
    [word(from), word(to), word(1n)],
    "0x",
  );
const mkSwap = (index: number, a: bigint, b: bigint) =>
  log(
    pool,
    index,
    "Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)",
    [word(router), word(wallet)],
    encode(
      parseAbiParameters("int256,int256,uint160,uint128,int24,uint128,uint128"),
      [a, b, tickSqrt(0), W, 0, 0n, 0n],
    ),
  );
const deposit = (index: number, a: bigint, b: bigint) => [
  erc(WETH, index, wallet, pool, a),
  erc(CBBTC, index + 1, wallet, pool, b),
  log(
    pool,
    index + 2,
    "Mint(address,address,int24,int24,uint128,uint256,uint256)",
    [word(MANAGER), int(-100), int(100)],
    encode(parseAbiParameters("address,uint128,uint256,uint256"), [
      MANAGER,
      W,
      a,
      b,
    ]),
  ),
  log(
    MANAGER,
    index + 4,
    "IncreaseLiquidity(uint256,uint128,uint256,uint256)",
    [word(1n)],
    encode(parseAbiParameters("uint128,uint256,uint256"), [W, a, b]),
  ),
];
const decrease = (index: number) =>
  log(
    MANAGER,
    index,
    "DecreaseLiquidity(uint256,uint128,uint256,uint256)",
    [word(1n)],
    encode(parseAbiParameters("uint128,uint256,uint256"), [W, W / 2n, B / 10n]),
  );
const collect = (index: number, a: bigint, b: bigint, reported = a) => [
  erc(WETH, index, pool, wallet, a),
  erc(CBBTC, index + 1, pool, wallet, b),
  log(
    pool,
    index + 2,
    "Collect(address,address,int24,int24,uint128,uint128)",
    [word(MANAGER), int(-100), int(100)],
    encode(parseAbiParameters("address,uint128,uint128"), [wallet, a, b]),
  ),
  log(
    MANAGER,
    index + 3,
    "Collect(uint256,address,uint256,uint256)",
    [word(1n)],
    encode(parseAbiParameters("address,uint256,uint256"), [
      wallet,
      reported,
      b,
    ]),
  ),
];

function fixture(
  to: string,
  logs: ChainLog[],
  result: "success" | "reverted" = "success",
): VerifiedActivity {
  const tx = {
    hash,
    from: wallet,
    to,
    value: 0n,
    input: "0x" as const,
    blockHash,
    blockNumber: 121n,
    transactionIndex: 3,
    type: 2n,
  };
  const block = { number: 121n, hash: blockHash, timestamp: 1730000000n };
  return {
    wallet,
    tx,
    block,
    at: new Date("2024-10-27T03:33:20.000Z"),
    finalized: true,
    topLevel: true,
    hasTokens: true,
    hasNfts: false,
    receipt: {
      ...tx,
      transactionHash: tx.hash,
      status: result === "success" ? "0x1" : "0x0",
      logs,
    },
    evidence: {
      from: wallet,
      to,
      value: "0",
      result,
      transfers: decodeTransfers(logs, wallet),
      omittedTransfers: 0,
      fees: { execution: "1800", l1: "200", operator: "0", total: "2000" },
    },
  };
}

function provider(
  tx: VerifiedActivity,
  options: {
    priorOwed?: bigint;
    burned?: boolean;
    extraLogs?: ChainLog[];
    archive?: boolean;
    fakePool?: boolean;
  } = {},
): BaseReader {
  return {
    assertChain: async () => {},
    transaction: async () => tx.tx,
    receipt: async () => tx.receipt,
    block: async () => tx.block,
    blockLogs: async () => [...tx.receipt.logs, ...(options.extraLogs ?? [])],
    call: vi.fn(async (to, data, block) => {
      if (options.archive === false) throw new ProviderError("CALL");
      if (to === MANAGER) {
        const { functionName } = decodeFunctionData({ abi: managerAbi, data });
        if (options.burned && block === 121n) throw new ProviderError("CALL");
        if (functionName === "ownerOf")
          return encodeFunctionResult({
            abi: managerAbi,
            functionName,
            result: wallet,
          });
        return encodeFunctionResult({
          abi: managerAbi,
          functionName,
          result: [
            0n,
            ZERO as Hex,
            WETH,
            CBBTC,
            500,
            -100,
            100,
            W,
            0n,
            0n,
            block === 120n ? (options.priorOwed ?? 0n) : 0n,
            0n,
          ],
        });
      }
      if (to === FACTORY)
        return encodeFunctionResult({
          abi: factoryAbi,
          functionName: "getPool",
          result: options.fakePool ? (ZERO as Hex) : pool,
        });
      const { functionName } = decodeFunctionData({ abi: poolAbi, data });
      switch (functionName) {
        case "token0":
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: WETH,
          });
        case "token1":
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: CBBTC,
          });
        case "fee":
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: 500,
          });
        case "slot0":
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: [tickSqrt(0), 0, 0, 0, 0, 0, true],
          });
        case "ticks":
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: [W, 0n, 0n, 0n, 0n, 0n, 0, true],
          });
        default:
          return encodeFunctionResult({
            abi: poolAbi,
            functionName,
            result: 0n,
          });
      }
    }),
  };
}

describe("Pancake v3 receipt evidence", () => {
  it("reconciles two opposite swaps in log order and never trusts a spoofed pool", async () => {
    const tx = fixture(router, [
      erc(CBBTC, 1, pool, wallet, B),
      erc(WETH, 2, wallet, pool, W),
      mkSwap(3, W, -B),
      erc(WETH, 4, pool, wallet, W / 2n),
      erc(CBBTC, 5, wallet, pool, B / 2n),
      mkSwap(6, -W / 2n, B / 2n),
    ]);
    expect(await classifyPancake(provider(tx), tx)).toMatchObject({
      status: "READY",
      draft: {
        actions: [
          { index: 3, kind: "SWAP", paid: ["1", "0"], received: ["0", "1"] },
          {
            index: 6,
            kind: "SWAP",
            paid: ["0", "0.5"],
            received: ["0.5", "0"],
          },
        ],
      },
    });
    expect(
      await classifyPancake(provider(tx, { fakePool: true }), tx),
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      draft: { actions: [] },
    });
    tx.tx.value = 1n;
    expect(await classifyPancake(provider(tx), tx)).toMatchObject({
      draft: { actions: [], warning: expect.stringMatching(/Native ETH/) },
    });
  });

  it("detects NFT mint and adds, but does not use a later same-block observation as an immediate snapshot", async () => {
    const [a, b, m, increased] = deposit(1, W, B);
    const mint = fixture(MANAGER, [a, b, m, nft(4, ZERO, wallet), increased]);
    expect(await classifyPancake(provider(mint), mint)).toMatchObject({
      status: "READY",
      draft: {
        actions: [
          {
            kind: "ADD",
            mint: true,
            amounts: ["1", "1"],
            snapshot: { unclaimed: ["0", "0"] },
          },
        ],
      },
    });
    const increase = fixture(MANAGER, deposit(1, W, B));
    const later = {
      ...mkSwap(20, W, -B),
      transactionIndex: 4,
      transactionHash: `0x${"3".repeat(64)}`,
    };
    expect(
      await classifyPancake(
        provider(increase, { extraLogs: [later] }),
        increase,
      ),
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      draft: { actions: [{ kind: "ADD", mint: false }] },
    });
    expect(
      await classifyPancake(provider(increase, { archive: false }), increase),
    ).toMatchObject({ status: "NEEDS_REVIEW" });
  });

  it("only labels a proved principal split, acknowledges rounding, and requires an actual collect", async () => {
    const collectOnly = fixture(MANAGER, collect(1, W / 10n, B / 2n));
    expect(
      await classifyPancake(provider(collectOnly), collectOnly),
    ).toMatchObject({
      draft: {
        actions: [
          {
            kind: "COLLECTION",
            principal: ["0", "0"],
            receipt: ["0.1", "0.5"],
          },
        ],
      },
    });
    const partial = fixture(MANAGER, [decrease(1), ...collect(2, W, B / 2n)]);
    expect(await classifyPancake(provider(partial), partial)).toMatchObject({
      draft: {
        actions: [{ principal: ["0.5", "0.1"], receipt: ["1", "0.5"] }],
      },
    });
    expect(
      await classifyPancake(provider(partial, { priorOwed: 2n }), partial),
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      draft: {
        actions: [{ principal: null, minimumPrincipal: ["0.5", "0.1"] }],
      },
    });
    const rounded = fixture(MANAGER, [
      decrease(1),
      ...collect(2, W - 1n, B / 2n, W),
      nft(6, wallet, ZERO),
    ]);
    expect(
      await classifyPancake(provider(rounded, { burned: true }), rounded),
    ).toMatchObject({
      draft: {
        actions: [
          {
            principal: null,
            receipt: ["0.999999999999999999", "0.5"],
            snapshot: { principal: ["0", "0"], unclaimed: ["0", "0"] },
          },
        ],
      },
    });
    const decreaseOnly = fixture(MANAGER, [decrease(1)]);
    expect(
      await classifyPancake(provider(decreaseOnly), decreaseOnly),
    ).toMatchObject({
      draft: { actions: [], warning: expect.stringMatching(/no tokens/) },
    });
    const reverted = fixture(MANAGER, [], "reverted");
    expect(await classifyPancake(provider(reverted), reverted)).toMatchObject({
      draft: { actions: [{ kind: "GAS_ONLY" }] },
    });
  });

  it("uses exact v3 boundaries and wraps fee-growth subtraction at uint256", () => {
    expect(tickSqrt(-887272)).toBe(4295128739n);
    expect(tickSqrt(887272)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
    const lower = tickSqrt(-100);
    const upper = tickSqrt(100);
    expect(liquidityAmounts(tickSqrt(-101), lower, upper, W)).toEqual([
      9_999_541_693_800_299n,
      0n,
    ]);
    expect(liquidityAmounts(tickSqrt(101), lower, upper, W)).toEqual([
      0n,
      9_999_541_693_800_299n,
    ]);
    expect(unrealizedFee(2n * Q, 0n, 0n, (1n << 256n) - Q, 3n, 0, -5, 5)).toBe(
      9n,
    );
  });
});
