"use client";

import {
  startTransition,
  useActionState,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { postWalletReview, previewWalletReview } from "@/app/wallet-actions";
import { presets } from "@/domain/catalog";
import { eventNames } from "@/domain/presentation";
import { baseTransactionUrl } from "@/lib/base-explorer";
import { decimal, usd } from "@/lib/display";
import { displayTime } from "@/lib/time";
import type { PancakeAction } from "@/server/onchain/pancake-v3";
import { Quotes } from "./reports";
import { Badge, Button, Panel } from "./ui";

type Row = {
  id: string;
  txHash: string;
  at: string;
  block: string;
  revision: number;
  fee: string | null;
  actions: PancakeAction[];
};
type Strategy = { id: string; name: string; baseline: string };
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
const pair = (amounts: (string | null)[]) =>
  amounts
    .map((amount, i) => `${amount ?? "Unknown"} ${presets.base.pair[i].symbol}`)
    .join(" / ");
const human = {
  SWAP: "Swap",
  ADD: "Add liquidity",
  COLLECTION: "Collect tokens",
  APPROVAL: "Approval gas",
  GAS_ONLY: "Reverted transaction gas",
};

function Resolution({ op, prefix }: { op: PancakeAction; prefix: string }) {
  if (op.kind === "SWAP")
    return (
      <div className="stack">
        <p>
          Pay {pair(op.paid)} · Receive {pair(op.received)}
        </p>
        <p className="muted wallet-id">Pool {op.pool}</p>
        <label className="field">
          Swap purpose
          <select name={`${prefix}purpose`} defaultValue="OTHER">
            <option value="ENTRY">Entry</option>
            <option value="EXIT">Exit</option>
            <option value="REBALANCE">Rebalance</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
      </div>
    );
  if (op.kind !== "ADD" && op.kind !== "COLLECTION")
    return <p className="muted">This action records no token transfers.</p>;
  const missingSnapshot = ["principal", "unclaimed"].some(
    (key) =>
      !op.snapshot ||
      op.snapshot[key as "principal" | "unclaimed"].includes(null),
  );
  return (
    <div className="stack">
      <p className="wallet-id">
        Position NFT #{op.tokenId} · Pool {op.pool}
        {op.kind === "ADD" && op.mint ? " · New position" : ""}
      </p>
      {op.kind === "ADD" ? (
        <p>Verified deposit: {pair(op.amounts)}</p>
      ) : (
        <div className="stack">
          <p>Verified receipt: {pair(op.receipt)}</p>
          {op.principal ? (
            <p className="muted">
              Principal: {pair(op.principal)}. Any remainder is the fee
              collection.
            </p>
          ) : (
            <>
              <p role="note">
                The receipt does not prove the principal/fee split. Enter the
                principal paid out; the remainder is the fee. Proven decrease in
                this receipt: {pair(op.minimumPrincipal)}.
              </p>
              <div className="field-grid">
                {presets.base.pair.map((token, i) => (
                  <label className="field" key={token.id}>
                    Principal paid · {token.symbol}
                    <input
                      name={`${prefix}split${i}`}
                      required
                      inputMode="decimal"
                      maxLength={49}
                    />
                  </label>
                ))}
                <label className="field">
                  Principal split source
                  <input
                    name={`${prefix}splitSource`}
                    required
                    maxLength={120}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}
      {op.snapshot && (
        <p className="muted">
          {op.snapshot.source} · In pool: {pair(op.snapshot.principal)} ·
          Unclaimed: {pair(op.snapshot.unclaimed)}
        </p>
      )}
      {missingSnapshot && (
        <details className="form-details">
          <summary>Optional snapshot details</summary>
          <p className="muted">
            Leave unknown amounts blank. Enter zero only if you can verify it.
          </p>
          <div className="field-grid">
            {(["principal", "unclaimed"] as const).flatMap((kind) =>
              presets.base.pair.map((token, i) =>
                (op.snapshot?.[kind][i] ?? null) === null ? (
                  <label className="field" key={`${kind}:${token.id}`}>
                    {kind === "principal"
                      ? "Principal in pool"
                      : "Unclaimed fees"}{" "}
                    · {token.symbol}
                    <input
                      name={`${prefix}${kind}${i}`}
                      inputMode="decimal"
                      maxLength={49}
                    />
                  </label>
                ) : null,
              ),
            )}
            <label className="field">
              Manual snapshot source
              <input name={`${prefix}snapshotSource`} maxLength={120} />
            </label>
          </div>
        </details>
      )}
    </div>
  );
}

function ReferencePrices({ index }: { index: number }) {
  const prefix = `r${index}_`;
  return (
    <details className="form-details">
      <summary>Historical reference prices</summary>
      <p className="muted">
        Automatic prices use independent event-time quotes. If a quote is
        missing, supply a manual USD price or leave it unresolved.
      </p>
      <div className="field-grid">
        {[...presets.base.pair, presets.base.native].map((asset, i) => (
          <div key={asset.id} className="stack">
            <label className="field">
              {asset.symbol} price mode
              <select name={`${prefix}p${i}Mode`} defaultValue="AUTO">
                <option value="AUTO">Automatic</option>
                <option value="MANUAL">Manual</option>
                <option value="MISSING">Leave missing</option>
              </select>
            </label>
            <label className="field">
              {asset.symbol} USD price
              <input
                name={`${prefix}p${i}Usd`}
                inputMode="decimal"
                maxLength={61}
              />
            </label>
          </div>
        ))}
        <label className="field">
          Independent price source
          <input name={`${prefix}priceSource`} maxLength={120} />
        </label>
        <label className="field">
          Manual price reason
          <input name={`${prefix}priceReason`} maxLength={250} />
        </label>
      </div>
    </details>
  );
}

export function WalletReview({
  rows,
  strategies,
  zone,
}: {
  rows: Row[];
  strategies: Strategy[];
  zone: string;
}) {
  const [state, preview, busy] = useActionState(previewWalletReview, {});
  const [post, submitPost, posting] = useActionState(postWalletReview, {});
  const [edited, setEdited] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setEdited(false);
    startTransition(() => preview(form));
  };
  if (strategies.length === 0)
    return (
      <Panel title="Set a strategy baseline first">
        <p className="muted">
          Create or update an open Base WETH/cbBTC strategy before posting.
          Record only the allocation that belongs to the strategy, before its
          first imported action. For a position already open, use a known
          opening snapshot and a post-entry or estimated baseline.
        </p>
        <div className="actions">
          <Button asChild>
            <Link href="/positions/new?from=wallet">Create a strategy</Link>
          </Button>
          <Link className="link" href="/positions">
            Open strategies
          </Link>
        </div>
      </Panel>
    );
  return (
    <>
      <Panel title="Confirm wallet actions" label={`${rows.length} SELECTED`}>
        <form
          className="stack"
          onSubmit={onSubmit}
          onChange={() => setEdited(true)}
        >
          {rows.map((row) => (
            <input name="activity" type="hidden" key={row.id} value={row.id} />
          ))}
          <label className="field">
            Destination strategy
            <select
              name="strategy"
              required
              defaultValue={strategies.length === 1 ? strategies[0].id : ""}
            >
              <option value="">Choose an open strategy</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.baseline}
                </option>
              ))}
            </select>
            <small>
              The batch will not create or change the opening allocation. Verify
              that assets and costs belong to this strategy.
            </small>
          </label>
          {rows.map((row, index) => (
            <section
              key={row.id}
              className="wallet-row stack"
              aria-label={`Review transaction ${short(row.txHash)}`}
            >
              <input
                type="hidden"
                name={`r${index}Version`}
                value={`${row.id}:${row.revision}`}
              />
              <div className="wallet-row-head">
                <h3>{short(row.txHash)}</h3>
                <a
                  className="link"
                  href={baseTransactionUrl(row.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on BaseScan
                </a>
              </div>
              <p className="muted">
                {displayTime(row.at, zone)} · Block {row.block}
              </p>
              <div className="field-grid">
                <label className="field">
                  Gas funding
                  <select name={`r${index}funding`} required defaultValue="">
                    <option value="">Choose where gas was paid from</option>
                    <option value="EXTERNAL">Outside strategy wallet</option>
                    <option value="STRATEGY_WALLET">
                      From strategy wallet
                    </option>
                  </select>
                  <small>
                    {row.fee
                      ? `${row.fee} · One charge for this transaction.`
                      : "Total network fee is not verified."}
                  </small>
                </label>
                {!row.fee && (
                  <>
                    <label className="field">
                      Total network fee in ETH
                      <input
                        name={`r${index}gasAmount`}
                        inputMode="decimal"
                        maxLength={49}
                      />
                    </label>
                    <label className="field">
                      Manual network fee source
                      <input name={`r${index}gasSource`} maxLength={120} />
                    </label>
                  </>
                )}
              </div>
              {row.actions.map((op, j) => (
                <div className="form-details stack" key={op.index}>
                  <h4>{human[op.kind]}</h4>
                  <Resolution op={op} prefix={`r${index}a${j}`} />
                </div>
              ))}
              <ReferencePrices index={index} />
            </section>
          ))}
          <label className="actions">
            <input type="checkbox" name="confirm" value="yes" required /> These
            actions, pool positions, and fees belong to the selected strategy.
          </label>
          {state.error && <p role="alert">{state.error}</p>}
          <div className="actions">
            <Button disabled={busy || posting} type="submit">
              {busy ? "Building preview…" : "Preview batch"}
            </Button>
          </div>
        </form>
      </Panel>
      {state.preview && (
        <Panel title="Batch preview" label="NOT POSTED">
          <div className="stack">
            <div className="actions">
              <Badge>Net wealth: {usd(state.preview.netWealth)}</Badge>
              <Badge>
                LP vs HODL: {usd(state.preview.outperformance, true)}
              </Badge>
              {Object.entries(state.preview.wallet).map(([id, amount]) => (
                <Badge key={id}>
                  {decimal(amount, 8)}{" "}
                  {[...presets.base.pair, presets.base.native].find(
                    (t) => t.id === id,
                  )?.symbol ?? id}
                </Badge>
              ))}
            </div>
            <p className="muted">
              This preview records the facts and quote set shown here. If you
              change any fields, preview again before posting.
            </p>
            {state.preview.groups.map((group) => (
              <details className="form-details" key={group.hash}>
                <summary>
                  {short(group.hash)} ·{" "}
                  {group.facts.map((fact) => eventNames[fact.kind]).join(", ")}
                </summary>
                <Quotes
                  prices={group.prices}
                  market={state.preview!.market}
                  zone={zone}
                />
                <pre className="table-scroll">
                  {JSON.stringify(group.facts, null, 2)}
                </pre>
              </details>
            ))}
            <form
              action={submitPost}
              key={state.preview.id}
              className="actions"
            >
              <input type="hidden" name="review" value={state.preview.id} />
              <Button type="submit" disabled={busy || posting || edited}>
                {posting ? "Posting…" : "Post selected"}
              </Button>
              {post.error && <p role="alert">{post.error}</p>}
            </form>
          </div>
        </Panel>
      )}
    </>
  );
}
