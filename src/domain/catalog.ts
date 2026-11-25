import type { Market } from "./model";

export const presets = {
  base: {
    chainId: "8453",
    network: "Base",
    pair: [
      {
        id: "8453:0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        decimals: 18,
        wrapsNative: true,
      },
      {
        id: "8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        symbol: "cbBTC",
        decimals: 8,
      },
    ],
    native: { id: "8453:native", symbol: "ETH", decimals: 18 },
  },
  ethereum: {
    chainId: "1",
    network: "Ethereum",
    pair: [
      {
        id: "1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        symbol: "WETH",
        decimals: 18,
        wrapsNative: true,
      },
      {
        id: "1:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        symbol: "cbBTC",
        decimals: 8,
      },
    ],
    native: { id: "1:native", symbol: "ETH", decimals: 18 },
  },
} satisfies Record<string, Market>;

export const mappings: Record<string, { slug: string; proxy?: string }> = {
  [presets.base.pair[0].id]: { slug: "l2-standard-bridged-weth-base" },
  [presets.ethereum.pair[0].id]: { slug: "weth" },
  [presets.base.pair[1].id]: { slug: "coinbase-wrapped-btc" },
  [presets.ethereum.pair[1].id]: { slug: "coinbase-wrapped-btc" },
  [presets.ethereum.native.id]: { slug: "ethereum" },
  [presets.base.native.id]: {
    slug: "ethereum",
    proxy: "Ethereum ETH is used as a proxy for the Base native ETH balance.",
  },
};

export const denominations = ["USD", "WETH", "cbBTC"] as const;
export type Denomination = (typeof denominations)[number];

export function referenceAsset(asset: string, den: string) {
  if (den !== "WETH" && den !== "cbBTC") return false;
  const i = den === "WETH" ? 0 : 1;
  return Object.values(presets).some((market) => market.pair[i].id === asset);
}
