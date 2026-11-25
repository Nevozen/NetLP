import {
  encodeAbiParameters,
  encodeFunctionResult,
  parseAbi,
  toEventSelector,
} from "viem";

const wallet = `0x${"a".repeat(40)}`;
const pool = `0x${"b".repeat(40)}`;
const nft = `0x${"c".repeat(40)}`;
const sender = `0x${"d".repeat(40)}`;
const weth = "0x4200000000000000000000000000000000000006";
const btc = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const router = "0x1b81d678ffb9c0263b24a97847620c99d213eb14";
const fixtureKey = "lpstacks_browser_fixture";
const txs = ["1", "2", "3"].map((digit) => `0x${digit.repeat(64)}`);
const hex = (number) =>
  `0x${Number.isInteger(number) ? number.toString(16) : BigInt(number).toString(16)}`;
const word = (value) =>
  `0x${(typeof value === "string" ? value.slice(2) : value.toString(16)).padStart(64, "0")}`;
const canonicalHash = (n) => word(BigInt(n) + 100n);
const baseBlock = 100_000;
const when = 1738368000;
const poolMethods = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);
const selectors = new Map([
  [toEventSelector("token0()").slice(0, 10), ["token0", weth]],
  [toEventSelector("token1()").slice(0, 10), ["token1", btc]],
  [toEventSelector("fee()").slice(0, 10), ["fee", 500]],
  [
    toEventSelector("getPool(address,address,uint24)").slice(0, 10),
    ["getPool", pool],
  ],
]);

function record(id) {
  const index = txs.indexOf(id);
  if (index < 0) return null;
  const blockNumber = baseBlock + index;
  return {
    hash: id,
    from: index === 2 ? sender : wallet,
    to: index === 2 ? nft : router,
    value: "0x0",
    input: "0x",
    blockNumber: hex(blockNumber),
    blockHash: canonicalHash(blockNumber),
    transactionIndex: "0x0",
    type: "0x2",
  };
}

function receipt(id) {
  const tx = record(id);
  if (!tx) return null;
  const index = txs.indexOf(id);
  const log = (address, i, signature, topics, data) => ({
    address,
    logIndex: hex(i),
    topics: [toEventSelector(signature), ...topics],
    data,
    blockHash: tx.blockHash,
    transactionHash: id,
    transactionIndex: "0x0",
  });
  const transfer = (contract, i, from, to, amount) =>
    log(
      contract,
      i,
      "Transfer(address,address,uint256)",
      [word(from), word(to)],
      word(amount),
    );
  const logs = [];
  if (index === 2) {
    logs.push(
      log(
        nft,
        1,
        "Transfer(address,address,uint256)",
        [word(sender), word(wallet), word(41n)],
        "0x",
      ),
    );
  } else {
    const paid = index === 0 ? 400000000000000000n : 990000n;
    const received = index === 0 ? 990000n : 390000000000000000n;
    logs.push(
      transfer(index === 0 ? btc : weth, 1, pool, wallet, received),
      transfer(index === 0 ? weth : btc, 2, wallet, pool, paid),
      log(
        pool,
        3,
        "Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)",
        [word(router), word(wallet)],
        encodeAbiParameters(
          [
            "int256",
            "int256",
            "uint160",
            "uint128",
            "int24",
            "uint128",
            "uint128",
          ].map((type) => ({ type })),
          [
            index === 0 ? paid : -received,
            index === 0 ? -received : paid,
            1n << 96n,
            100n,
            0,
            0n,
            0n,
          ],
        ),
      ),
    );
  }
  return {
    ...tx,
    status: "0x1",
    transactionHash: id,
    logs,
    gasUsed: "0x5208",
    effectiveGasPrice: hex(3_000_000_000),
    l1Fee: hex(17_000_000_000_000),
  };
}

const orig = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== `https://base-mainnet.g.alchemy.com/v2/${fixtureKey}`)
    return orig(input, init);
  const packet = JSON.parse(
    init?.body ?? (input instanceof Request ? await input.text() : "{}"),
  );
  const [p] = packet.params;
  let result;
  switch (packet.method) {
    case "eth_chainId":
      result = "0x2105";
      break;
    case "eth_getBlockByNumber": {
      const n = p === "latest" || p === "finalized" ? baseBlock + 3 : Number(p);
      result = {
        number: hex(n),
        hash: canonicalHash(n),
        timestamp: hex(when + Math.max(0, n - baseBlock) * 2),
      };
      break;
    }
    case "eth_getTransactionByHash":
      result = record(p);
      break;
    case "eth_getTransactionReceipt":
      result = receipt(p);
      break;
    case "alchemy_getAssetTransfers": {
      const from = p.fromAddress === wallet;
      const to = p.toAddress === wallet;
      result = {
        transfers: (from ? txs.slice(0, 2) : to ? txs : [])
          .filter((tx) => {
            const n = Number(record(tx).blockNumber);
            return n >= Number(p.fromBlock) && n <= Number(p.toBlock);
          })
          .map((hash) => ({ hash })),
      };
      break;
    }
    case "eth_call": {
      const [functionName, value] = selectors.get(p.data.slice(0, 10)) ?? [];
      result = functionName
        ? encodeFunctionResult({
            abi: poolMethods,
            functionName,
            result: value,
          })
        : "0x";
      break;
    }
    default:
      throw new Error("Unsupported browser fixture request.");
  }
  return Response.json({ jsonrpc: "2.0", id: 1, result });
};
