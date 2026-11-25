import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatUnits } from "viem";
import { ignoreWalletActivity, reviewSelection } from "@/app/wallet-actions";
import { get, type Query } from "@/components/filters";
import { Badge, Button, Empty, Panel } from "@/components/ui";
import {
  SelectionButton,
  SyncNow,
  WalletImportForm,
} from "@/components/wallet-controls";
import { baseAddressUrl, baseTransactionUrl } from "@/lib/base-explorer";
import { displayTime } from "@/lib/time";
import { database } from "@/server/db";
import { evidenceSchema, showTransfer } from "@/server/onchain/activity";
import { baseEndpoints } from "@/server/onchain/base-rpc";
import { pancakeDraftSchema } from "@/server/onchain/pancake-v3";
import {
  activityFilter,
  activityOrder,
  createWalletStore,
  walletCategory,
  type WalletCategory,
} from "@/server/onchain/wallet-store";
import type { WalletStatus } from "@/generated/prisma/enums";

export const walletStatusLabels = {
  DETECTED: "Detected",
  CONFIRMING: "Confirming",
  READY: "Ready",
  NEEDS_REVIEW: "Needs review",
  ACTIVITY_ONLY: "Activity only",
  POSTED: "Posted",
  UNRELATED: "Unrelated",
} satisfies Record<WalletStatus, string>;
const categories: [WalletCategory, string][] = [
  ["ALL", "All activity"],
  ["TX", "Transactions"],
  ["TOKEN", "Token Transfers"],
  ["NFT", "NFT Transfers"],
];
const sources = {
  ALCHEMY: "Alchemy",
  CSV: "BaseScan CSV",
  HASH: "Transaction hash",
} as const;
export const shortId = (value: string) =>
  `${value.slice(0, 10)}…${value.slice(-6)}`;
export const ethUnits = (wei: string | null | undefined) =>
  wei == null ? "Unknown" : `${formatUnits(BigInt(wei), 18)} ETH`;

export async function WalletActivity({
  userId,
  zone,
  query,
}: {
  userId: string;
  zone: string;
  query: Query;
}) {
  const db = database();
  const store = createWalletStore(db);
  const watch = await store.watch(userId);
  if (!watch)
    return (
      <Panel title="Wallet activity" label="BASE / READ-ONLY">
        <Empty
          title="Watch a public Base address"
          action={
            <Button asChild>
              <Link href="/settings">Open Settings</Link>
            </Button>
          }
        >
          View wallet activity and import verified PancakeSwap v3 entries
          without connecting a wallet.
        </Empty>
      </Panel>
    );
  const provider = baseEndpoints();
  const filter = walletCategory.safeParse(get(query, "category")).data ?? "ALL";
  const ignored = get(query, "ignored") === "yes";
  const page = /^\d{1,4}$/.test(get(query, "page"))
    ? Math.max(1, Number(get(query, "page")))
    : 1;
  const pageSize = 25;
  const [rows, counts] = await Promise.all([
    db.walletActivity.findMany({
      where: activityFilter(userId, watch.address, filter, ignored),
      orderBy: activityOrder,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    }),
    store.counts(userId, watch.address),
  ]);
  const url = (category = filter, pageNumber = 1, showIgnored = ignored) =>
    `/transactions?${new URLSearchParams({ view: "wallet", category, page: String(pageNumber), ...(showIgnored ? { ignored: "yes" } : {}) })}`;
  const totalSelection = rows
    .slice(0, pageSize)
    .some(
      (row) =>
        !row.ignored &&
        ["READY", "NEEDS_REVIEW"].includes(row.status) &&
        Boolean(pancakeDraftSchema.safeParse(row.draft).data?.actions.length),
    );
  const enabled =
    !!provider.rpc &&
    (counts.pending > 0 || (watch.enabled && !!provider.indexer));
  return (
    <>
      <Panel
        title="Wallet activity"
        label="BASE / READ-ONLY"
        action={<SyncNow enabled={enabled} updatedAt={+watch.updatedAt} />}
      >
        <div className="stack">
          <div className="actions">
            <a
              className="link wallet-id"
              href={baseAddressUrl(watch.address)}
              target="_blank"
              rel="noreferrer"
            >
              {watch.address}
            </a>
            <Badge tone={watch.issue ? "warn" : "neutral"}>
              {provider.rpc && provider.indexer
                ? watch.enabled
                  ? "Automatic sync"
                  : "Paused"
                : provider.rpc
                  ? "CSV / hash only"
                  : "Provider not configured"}
            </Badge>
            <Link className="link" href="/settings">
              Change settings
            </Link>
          </div>
          <p className="muted">
            {watch.lastSyncedAt
              ? `Last checked ${displayTime(watch.lastSyncedAt, zone)}. `
              : "Not synced yet. "}
            {watch.nextBlock != null &&
            watch.startBlock != null &&
            watch.nextBlock > watch.startBlock
              ? `Scanned blocks ${watch.startBlock}–${watch.nextBlock - 1n}. `
              : ""}
            {watch.cursor != null ? "Backfill in progress. " : ""}
            {counts.pending
              ? `${counts.pending} awaiting verification or finality. `
              : ""}
            {counts.unrelated
              ? `${counts.unrelated} unrelated to this wallet and hidden. `
              : ""}
            Discovery may miss approvals, failed calls, or other transactions
            without indexed transfers.
          </p>
          {watch.issue && (
            <p role="status" className="muted">
              {watch.issue}
            </p>
          )}
          <nav aria-label="Wallet activity filters" className="chips">
            {categories.map(([kind, label]) => (
              <Link
                key={kind}
                className={`button ${kind === filter ? "button-primary" : "button-outline"}`}
                aria-current={kind === filter ? "page" : undefined}
                href={url(kind)}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="actions">
            <a
              className="link"
              href={`/transactions/export?${new URLSearchParams({ category: filter, ...(ignored ? { ignored: "yes" } : {}) })}`}
            >
              Export activity CSV
            </a>
            <Link className="link" href={url(filter, 1, !ignored)}>
              {ignored ? "Show active" : "Show ignored"}
            </Link>
          </div>
          {get(query, "selection") === "invalid" && (
            <p role="alert">
              Select between one and ten eligible transactions.
            </p>
          )}
          <form action={reviewSelection} id="wallet-selection">
            {totalSelection && <SelectionButton />}
          </form>
          {!rows.length && (
            <p className="muted">No wallet activity matches this view.</p>
          )}
          {rows.slice(0, pageSize).map((row) => {
            const evidence = evidenceSchema.safeParse(row.evidence).data;
            const draft = pancakeDraftSchema.safeParse(row.draft).data;
            const selectable =
              !row.ignored &&
              !!draft?.actions.length &&
              ["READY", "NEEDS_REVIEW"].includes(row.status);
            const transfers =
              evidence?.transfers.filter((t) =>
                filter === "TOKEN"
                  ? t.standard === "ERC-20"
                  : filter === "NFT"
                    ? t.standard !== "ERC-20"
                    : true,
              ) ?? [];
            const selectionLabel = `Select ${shortId(row.txHash)}`;
            return (
              <article
                key={row.id}
                className="wallet-row stack"
                aria-label={`Transaction ${shortId(row.txHash)}`}
              >
                <div className="wallet-row-head">
                  <div className="actions">
                    {selectable && (
                      <input
                        type="checkbox"
                        form="wallet-selection"
                        name="activity"
                        value={row.id}
                        aria-label={selectionLabel}
                      />
                    )}
                    <strong>{shortId(row.txHash)}</strong>
                    <Badge
                      tone={
                        row.status === "READY" || row.status === "POSTED"
                          ? "good"
                          : row.status === "NEEDS_REVIEW"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {row.ignored ? "Ignored" : walletStatusLabels[row.status]}
                    </Badge>
                    {evidence?.result === "reverted" && (
                      <Badge tone="warn">Reverted</Badge>
                    )}
                  </div>
                  <a
                    className="link actions"
                    href={baseTransactionUrl(row.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on BaseScan{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </div>
                <small className="muted">
                  {row.occurredAt
                    ? `${displayTime(row.occurredAt, zone)} · Block ${row.blockNumber}`
                    : "Waiting for a verified receipt"}
                  {" · "}
                  {row.sources.map((source) => sources[source]).join(" / ")}
                </small>
                <div className="actions">
                  {row.topLevel && <Badge>Transaction</Badge>}
                  {row.hasTokens && <Badge>ERC-20</Badge>}
                  {row.hasNfts && <Badge>NFT</Badge>}
                  {draft?.actions.length ? <Badge>PancakeSwap v3</Badge> : null}
                </div>
                {draft?.warning && <p className="muted">{draft.warning}</p>}
                {evidence && (
                  <details>
                    <summary>
                      Receipt and transfers ({transfers.length})
                    </summary>
                    <p className="wallet-id muted">
                      From {evidence.from} to{" "}
                      {evidence.to ?? "contract creation"} · Top-level value{" "}
                      {ethUnits(evidence.value)}
                    </p>
                    {evidence.from === watch.address && (
                      <p className="muted">
                        Wallet gas: {ethUnits(evidence.fees.total)} · Execution{" "}
                        {ethUnits(evidence.fees.execution)} · L1{" "}
                        {ethUnits(evidence.fees.l1)} · Operator{" "}
                        {ethUnits(evidence.fees.operator)}
                      </p>
                    )}
                    {transfers.map((transfer) => (
                      <p
                        key={`${transfer.logIndex}:${transfer.item}`}
                        className="wallet-id"
                      >
                        {transfer.from === watch.address &&
                        transfer.to === watch.address
                          ? "Self"
                          : transfer.from === watch.address
                            ? "Out"
                            : "In"}
                        {" · "}
                        {showTransfer(transfer)}{" "}
                        <small className="muted">{transfer.contract}</small>
                      </p>
                    ))}
                    {evidence.omittedTransfers > 0 && (
                      <p className="muted">
                        {evidence.omittedTransfers} additional transfers
                        omitted; review the full receipt on BaseScan.
                      </p>
                    )}
                  </details>
                )}
                <div className="actions">
                  {row.postedStrategyId && row.postedEventIds[0] ? (
                    <Link
                      className="link"
                      href={`/positions/${row.postedStrategyId}/event/${row.postedEventIds[0]}`}
                    >
                      View posted entry
                    </Link>
                  ) : (
                    <form action={ignoreWalletActivity}>
                      <input type="hidden" name="id" value={row.id} />
                      <input
                        type="hidden"
                        name="ignore"
                        value={row.ignored ? "no" : "yes"}
                      />
                      <Button type="submit" tone="quiet">
                        {row.ignored ? "Restore activity" : "Ignore"}
                      </Button>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
          {(page > 1 || rows.length > pageSize) && (
            <nav className="actions" aria-label="Wallet activity pagination">
              {page > 1 && (
                <Link className="link" href={url(filter, page - 1)}>
                  Previous
                </Link>
              )}
              <span>Page {page}</span>
              {rows.length > pageSize && (
                <Link className="link" href={url(filter, page + 1)}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      </Panel>
      <Panel title="Import missing activity">
        {!provider.rpc && (
          <p className="muted">
            Set a Base RPC endpoint on the server to verify CSV or hash imports.
          </p>
        )}
        <WalletImportForm enabled={!!provider.rpc} />
      </Panel>
    </>
  );
}
