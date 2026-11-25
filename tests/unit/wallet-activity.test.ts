import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Hex,
} from "viem";
import { alchemyDiscovery } from "@/server/onchain/alchemy";
import { decodeTransfers } from "@/server/onchain/activity";
import {
  blockTime,
  operatorFee,
  type ChainLog,
} from "@/server/onchain/base-rpc";
import { csvHashes } from "@/server/onchain/wallet-csv";
import { scanPage, scanRange } from "@/server/onchain/wallet-sync";

const addr = (n: string) => `0x${n.repeat(40)}` as const;
const hash = (n: string) => `0x${n.repeat(64)}` as const;
const from = addr("a");
const to = addr("b");
const id = hash("1");
const log = (
  topics: (Hex | null | Hex[])[],
  data: Hex,
  logIndex: number,
): ChainLog => ({
  address: addr("1"),
  blockHash: hash("2"),
  transactionHash: id,
  transactionIndex: 3,
  topics: topics as Hex[],
  logIndex,
  data,
});
const tokenAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const nftAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const batchAbi = parseAbi([
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
]);
const singleAbi = parseAbi([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
]);

describe("wallet activity sources", () => {
  it("uses only the hash column, supporting quoted records/BOM and deduplicating exact hashes", () => {
    const text = `\uFEFF"Txn Hash","Private Notes"\r\n"${id}","a,b\nand ""quotes"""\r\n"${id.toUpperCase()}","no"\r\n"oops","=formula"\r\n`;
    expect(csvHashes(text)).toEqual({
      hashes: [id],
      invalid: 1,
      duplicates: 1,
    });
    expect(() => csvHashes(`"Txn Hash","Hash"\n"${id}","x"`)).not.toThrow();
    expect(() =>
      csvHashes(`"Txn Hash","Transaction Hash"\n"${id}","x"`),
    ).toThrow(/exactly one/);
  });

  it("requests both directions as separate, bounded pages without using indexer amounts", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        pageKey: "next",
        transfers: [{ hash: id, value: 0.000001 }, { hash: id }],
      });
    const get = alchemyDiscovery(request);
    const cursor = scanRange(100n, 100n, 150n)!;
    const result = await get({
      wallet: from,
      from: 100n,
      to: 150n,
      direction: cursor.direction,
    });
    expect(result.hashes).toEqual([id]);
    const page = scanPage(cursor, result.pageKey);
    expect(page).toEqual({ cursor: { ...cursor, pageKey: "next" } });
    const second = scanPage(page.cursor!).cursor!;
    await get({
      wallet: from,
      from: BigInt(second.from),
      to: BigInt(second.to),
      direction: second.direction,
    });
    expect(request.mock.calls.map((call) => call[1][0])).toEqual([
      expect.objectContaining({
        fromAddress: from,
        fromBlock: "0x64",
        toBlock: "0x96",
      }),
      expect.objectContaining({
        toAddress: from,
        fromBlock: "0x64",
        toBlock: "0x96",
      }),
    ]);
    expect(scanPage(second)).toEqual({ cursor: null, through: 151n });
    expect(scanRange(100n, 5000n, 5007n)?.from).toBe("3500");
  });

  it("keeps identical ERC-20 transfers separate and recognizes ERC-721 and ERC-1155", () => {
    const raw = 12345678912345678912345n;
    const erc20 = (i: number) =>
      log(
        encodeEventTopics({
          abi: tokenAbi,
          eventName: "Transfer",
          args: { from, to },
        }),
        encodeAbiParameters([{ type: "uint256" }], [raw]),
        i,
      );
    const logs = [
      erc20(1),
      erc20(2),
      log(
        encodeEventTopics({
          abi: nftAbi,
          eventName: "Transfer",
          args: { from, to, tokenId: 77n },
        }),
        "0x",
        3,
      ),
      log(
        encodeEventTopics({
          abi: batchAbi,
          eventName: "TransferBatch",
          args: { from, to, operator: addr("e") },
        }),
        encodeAbiParameters(
          [{ type: "uint256[]" }, { type: "uint256[]" }],
          [
            [7n, 7n],
            [1n, 2n],
          ],
        ),
        4,
      ),
      log(
        encodeEventTopics({
          abi: singleAbi,
          eventName: "TransferSingle",
          args: { from, to, operator: addr("e") },
        }),
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }],
          [8n, 3n],
        ),
        5,
      ),
      { ...erc20(6), data: "0x00" as const },
    ];
    expect(
      decodeTransfers(logs, from).map(
        ({ logIndex, item, standard, units, tokenId }) => [
          logIndex,
          item,
          standard,
          units,
          tokenId,
        ],
      ),
    ).toEqual([
      [1, 0, "ERC-20", raw.toString(), undefined],
      [2, 0, "ERC-20", raw.toString(), undefined],
      [3, 0, "ERC-721", "1", "77"],
      [4, 0, "ERC-1155", "1", "7"],
      [4, 1, "ERC-1155", "2", "7"],
      [5, 0, "ERC-1155", "3", "8"],
    ]);
    expect(decodeTransfers(logs, addr("e"))).toEqual([]);
  });

  it("uses fork-specific operator fees and keeps Base milliseconds when present", () => {
    expect(operatorFee(21_000n, 1746806400n, 99n, 100n)).toBe(0n);
    expect(operatorFee(21_000n, 1746806401n, 1000n, 4n)).toBe(25n);
    expect(operatorFee(21_000n, 1764691201n, 3n, 4n)).toBe(6_300_004n);
    expect(
      blockTime({
        number: 4n,
        hash: id,
        timestamp: 1000n,
        timestampMs: 1000200n,
      }).toISOString(),
    ).toBe("1970-01-01T00:16:40.200Z");
  });
});
