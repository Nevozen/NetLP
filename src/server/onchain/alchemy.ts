import { z } from "zod";
import { hash } from "@/domain/model";
import { blockHex, checked, rpcTransport } from "./base-rpc";

type Query = {
  wallet: string;
  from: bigint;
  to: bigint;
  direction: "out" | "in";
  pageKey?: string;
};

const response = z.object({
  transfers: z.array(z.object({ hash })).max(100),
  pageKey: z.string().min(1).max(256).nullish(),
});

export function alchemyDiscovery(request: ReturnType<typeof rpcTransport>) {
  return async ({ wallet, from, to, direction, pageKey }: Query) => {
    const data = checked(
      response,
      await request("alchemy_getAssetTransfers", [
        {
          fromBlock: blockHex(from),
          toBlock: blockHex(to),
          [direction === "out" ? "fromAddress" : "toAddress"]: wallet,
          category: ["external", "erc20", "erc721", "erc1155"],
          order: "asc",
          excludeZeroValue: false,
          maxCount: "0x64",
          ...(pageKey ? { pageKey } : {}),
        },
      ]),
    );
    return {
      hashes: [...new Set(data.transfers.map((transfer) => transfer.hash))],
      pageKey: data.pageKey ?? undefined,
    };
  };
}

export type WalletDiscovery = ReturnType<typeof alchemyDiscovery>;
