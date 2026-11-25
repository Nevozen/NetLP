import { auth } from "@/server/auth";
import { database } from "@/server/db";
import { csvCell } from "@/server/export";
import { evidenceSchema } from "@/server/onchain/activity";
import {
  activityFilter,
  activityOrder,
  createWalletStore,
  walletCategory,
} from "@/server/onchain/wallet-store";

export const dynamic = "force-dynamic";
const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers: noStore });
  const db = database();
  const watch = await createWalletStore(db).watch(session.user.id);
  if (!watch) return new Response(null, { status: 404, headers: noStore });
  const query = new URL(request.url).searchParams;
  const category =
    walletCategory.safeParse(query.get("category")).data ?? "ALL";
  const rows = await db.walletActivity.findMany({
    where: activityFilter(
      session.user.id,
      watch.address,
      category,
      query.get("ignored") === "yes",
    ),
    orderBy: activityOrder,
    take: 501,
  });
  const asLine = (cells: (string | null | undefined)[]) =>
    cells.map(csvCell).join(",");
  const lines = [
    asLine([
      "UTC timestamp",
      "chain id",
      "transaction hash",
      "block",
      "block hash",
      "transaction index",
      "type",
      "status",
      "execution status",
      "sources",
      "from",
      "to",
      "token contract",
      "token id",
      "quantity (base units)",
      "transaction value (wei)",
      "wallet gas (wei)",
      "log index",
      "batch item",
    ]),
  ];
  for (const item of rows.slice(0, 500)) {
    const evidence = evidenceSchema.safeParse(item.evidence).data;
    const transfers = evidence?.transfers ?? [];
    const head = [
      item.occurredAt?.toISOString(),
      item.chainId,
      item.txHash,
      item.blockNumber?.toString(),
      item.blockHash,
      item.txIndex?.toString(),
    ];
    const data = [
      item.ignored ? "IGNORED" : item.status,
      evidence?.result,
      item.sources.join(" / "),
    ];
    if (
      (category === "ALL" && (item.topLevel || transfers.length === 0)) ||
      category === "TX"
    )
      lines.push(
        asLine([
          ...head,
          item.topLevel ? "Transaction" : "Detected",
          ...data,
          evidence?.from,
          evidence?.to,
          null,
          null,
          null,
          evidence?.value,
          evidence?.from === watch.address ? evidence.fees.total : null,
          null,
          null,
        ]),
      );
    if (category !== "TX") {
      for (const transfer of transfers) {
        if (
          (category === "TOKEN" && transfer.standard !== "ERC-20") ||
          (category === "NFT" && transfer.standard === "ERC-20")
        )
          continue;
        lines.push(
          asLine([
            ...head,
            transfer.standard,
            ...data,
            transfer.from,
            transfer.to,
            transfer.contract,
            transfer.tokenId,
            transfer.units,
            null,
            null,
            transfer.logIndex.toString(),
            transfer.item.toString(),
          ]),
        );
      }
    }
  }
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      ...noStore,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="lpstacks-wallet-activity.csv"',
      "X-LPStacks-Export-Truncated": rows.length > 500 ? "true" : "false",
    },
  });
}
