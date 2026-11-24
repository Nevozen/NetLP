"use client";

import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useState,
} from "react";
import { ArrowRight, Plus } from "lucide-react";
import {
  openCycle,
  updateMark,
  updateMetadata,
  writeEvent,
  type FormState,
} from "@/app/actions";
import { mappings, presets } from "@/domain/catalog";
import { type Market, type Token, tokens, USD_CASH } from "@/domain/model";
import { eventNames, positionsStates } from "@/domain/presentation";
import { decimal, human, usd } from "@/lib/display";
import type { Fields } from "@/server/form-data";
import { Button } from "./ui";

type Option = [string, string];
type FieldsApi = ReturnType<typeof useFields>;
type EditorAction = (state: FormState, form: FormData) => Promise<FormState>;

function useEditorAction(action: EditorAction) {
  const [state, dispatch, busy] = useActionState(action, {});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Preview and validation must not reset the user's form before the actual posting.
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, button);
    startTransition(() => dispatch(form));
  };
  return [state, submit, busy] as const;
}
const selections = (obj: Record<string, string>): Option[] =>
  Object.entries(obj);
const gasFunding: Option[] = [
  ["EXTERNAL", "Outside strategy wallet"],
  ["STRATEGY_WALLET", "From strategy wallet"],
];
const simple = (values: string[]): Option[] =>
  values.map((value) => [value, human(value)]);
const assetOptions = (market: Market) =>
  tokens(market).map((t): Option => [t.id, t.symbol]);

function useFields(initial: Fields) {
  const [values, setValues] = useState(initial);
  const set = (name: string, value: string) =>
    setValues((previous) => ({ ...previous, [name]: value }));
  const bind = (name: string, fallback = "") => ({
    name,
    value: values[name] ?? fallback,
    onChange: (e: { target: { value: string } }) => set(name, e.target.value),
  });
  return { values, set, bind };
}

function Text({
  f,
  name,
  label,
  fallback,
  type = "text",
  number,
  hint,
}: {
  f: FieldsApi;
  name: string;
  label: string;
  fallback?: string;
  type?: string;
  number?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        type={type}
        aria-label={label}
        aria-describedby={hint ? `hint-${name}` : undefined}
        step={type === "datetime-local" ? ".001" : undefined}
        inputMode={number ? "decimal" : undefined}
        maxLength={120}
        {...f.bind(name, fallback)}
      />
      {hint && <small id={`hint-${name}`}>{hint}</small>}
    </label>
  );
}

function Select({
  f,
  name,
  label,
  options,
  fallback,
}: {
  f: FieldsApi;
  name: string;
  label: string;
  options: Option[];
  fallback?: string;
}) {
  return (
    <label className="field">
      {label}
      <select aria-label={label} {...f.bind(name, fallback ?? options[0]?.[0])}>
        {options.map(([key, title]) => (
          <option value={key} key={key}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}

function Notes({
  f,
  name = "notes",
  label = "Journal note",
}: {
  f: FieldsApi;
  name?: string;
  label?: string;
}) {
  return (
    <label className="field">
      {label}
      <textarea aria-label={label} maxLength={2000} {...f.bind(name)} />
    </label>
  );
}

function PairFields({
  f,
  market,
  stem,
  label,
}: {
  f: FieldsApi;
  market: Market;
  stem: string;
  label: string;
}) {
  return (
    <div className="field-grid">
      {market.pair.map((t, i) => (
        <Text
          key={i}
          f={f}
          name={`${stem}${i}`}
          label={`${label} · ${t.symbol}`}
          number
        />
      ))}
    </div>
  );
}

function LegFields({
  f,
  market,
  protocol = "",
}: {
  f: FieldsApi;
  market: Market;
  protocol?: string;
}) {
  return (
    <fieldset className="stack">
      <legend>LP leg</legend>
      <div className="field-grid">
        <Text
          f={f}
          name="legProtocol"
          label="Leg protocol / version"
          fallback={protocol}
        />
        <Text f={f} name="pool" label="Pool reference (optional)" />
        <Text f={f} name="positionId" label="Position ID (optional)" />
        <Text f={f} name="feeTier" label="Fee tier or dynamic fee (optional)" />
        <Text
          f={f}
          name="lower"
          label={`Lower bound · ${market.pair[1].symbol} per ${market.pair[0].symbol}`}
          number
        />
        <Text
          f={f}
          name="upper"
          label={`Upper bound · ${market.pair[1].symbol} per ${market.pair[0].symbol}`}
          number
        />
        <Select
          f={f}
          name="feeAttribution"
          label="LP fee attribution"
          options={[
            ["TRACKED", "Separately tracked"],
            ["UNAVAILABLE", "Unverified / auto-compounded"],
          ]}
        />
      </div>
    </fieldset>
  );
}

function PositionFields({ f, market }: { f: FieldsApi; market: Market }) {
  return (
    <fieldset className="stack">
      <legend>Observed position</legend>
      <p className="muted">
        Enter principal <strong>excluding fees</strong>. Blank means unknown;
        enter 0 only when observed.
      </p>
      <PairFields f={f} market={market} stem="principal" label="Principal" />
      <PairFields f={f} market={market} stem="pending" label="Unclaimed fees" />
      <div className="field-grid">
        <Text
          f={f}
          name="snapshotSource"
          label="Snapshot source"
          fallback="Manual observation"
        />
        <Select
          f={f}
          name="range"
          label="Observed range status"
          options={[
            ["UNKNOWN", positionsStates.UNKNOWN],
            ["IN_RANGE", positionsStates.IN_RANGE],
            ["OUT_OF_RANGE", positionsStates.OUT_OF_RANGE],
          ]}
        />
        <Text
          f={f}
          name="ratio"
          label="Observed token1 per token0 (optional)"
          number
        />
        <Text
          f={f}
          name="liquidity"
          label="Observed liquidity (optional)"
          number
        />
      </div>
    </fieldset>
  );
}

function PricingFields({
  f,
  market,
  keep,
  zone,
}: {
  f: FieldsApi;
  market: Market;
  keep?: boolean;
  zone: string;
}) {
  const assets = tokens(market);
  return (
    <fieldset className="stack">
      <legend>Reference prices</legend>
      <p className="muted">
        Use independent USD market prices, not the execution price from your
        swap. Missing prices leave affected metrics incomplete.
      </p>
      {assets.map((token, i) => {
        const options: Option[] = [
          ...(keep ? [["KEEP", "Preserve posted quote"] as Option] : []),
          ...(mappings[token.id] ? [["AUTO", "CoinGecko"] as Option] : []),
          ["MISSING", "Not available"],
          ["MANUAL", "Manual USD"],
        ];
        return (
          <div className="field-grid" key={i}>
            <Select
              f={f}
              name={`p${i}Mode`}
              label={`${token.symbol} price mode`}
              options={options}
            />
            {f.values[`p${i}Mode`] === "MANUAL" && (
              <>
                <Text
                  f={f}
                  name={`p${i}Usd`}
                  label={`${token.symbol} USD price`}
                  number
                />
                <Text
                  f={f}
                  name={`p${i}Observed`}
                  label={`${token.symbol} observed time (optional)`}
                  type="datetime-local"
                  hint={`Defaults to the reference time. ${zone}.`}
                />
              </>
            )}
          </div>
        );
      })}
      {assets.some((_, i) => f.values[`p${i}Mode`] === "MANUAL") && (
        <div className="field-grid">
          <Text f={f} name="priceSource" label="Independent price source" />
          <Text f={f} name="priceReason" label="Manual price reason" />
        </div>
      )}
    </fieldset>
  );
}

function Preview({ state, market }: { state: FormState; market?: Market }) {
  if (state.error)
    return (
      <p role="alert" className="alert warn">
        {state.error}
      </p>
    );
  const p = state.preview;
  if (!p) return null;
  const symbol = (id: string) =>
    market ? (tokens(market).find((a) => a.id === id)?.symbol ?? id) : id;
  return (
    <section className="alert stack" aria-live="polite">
      <div>
        <h3>Accounting preview</h3>
        <p>Net wealth {usd(p.netWealth)} · Wallet after journal replay</p>
      </div>
      <div className="chips">
        {Object.entries(p.wallet).map(([asset, amount]) => (
          <span key={asset} className="num">
            {decimal(amount)} {symbol(asset)}
          </span>
        ))}
      </div>
      {p.shortfall !== undefined && (
        <p>
          Execution shortfall {usd(p.shortfall, true)} · {decimal(p.bps, 4)} bps
        </p>
      )}
      {p.costs !== undefined && (
        <p>Cycle operational costs (historical): {usd(p.costs)}</p>
      )}
      <div>
        {p.prices.map((q) => (
          <p key={q.asset}>
            <strong>{symbol(q.asset)}</strong> {usd(q.usd)} · {human(q.quality)}{" "}
            · {q.source}
            {q.observedAt ? ` · observed ${q.observedAt}` : ""}
            {q.note ? ` · ${q.note}` : ""}
          </p>
        ))}
      </div>
    </section>
  );
}

function Submit({
  busy,
  label,
  draft,
  danger,
  preview = true,
}: {
  busy: boolean;
  label: string;
  draft?: boolean;
  danger?: boolean;
  preview?: boolean;
}) {
  return (
    <div className="actions">
      <Button
        type="submit"
        name="intent"
        value="post"
        tone={danger ? "danger" : "primary"}
        disabled={busy}
      >
        {busy ? "Working..." : label}
        <ArrowRight size={15} aria-hidden="true" />
      </Button>
      {preview && (
        <Button
          type="submit"
          name="intent"
          value="preview"
          tone="outline"
          disabled={busy}
        >
          Preview accounting
        </Button>
      )}
      {draft && (
        <Button
          type="submit"
          name="intent"
          value="draft"
          tone="quiet"
          disabled={busy}
          formNoValidate
        >
          Save draft
        </Button>
      )}
    </div>
  );
}

function TimeField({
  f,
  zone,
  label = "Event date and time",
}: {
  f: FieldsApi;
  zone: string;
  label?: string;
}) {
  return (
    <Text
      f={f}
      name="at"
      label={label}
      type="datetime-local"
      hint={`${zone} (stored in UTC)`}
    />
  );
}

function OpeningFields({
  f,
  market,
  protocol,
}: {
  f: FieldsApi;
  market: Market;
  protocol?: string;
}) {
  const baseline = f.values.baseline ?? "PRE_ENTRY_VERIFIED";
  const importing =
    baseline === "POST_ENTRY_ONLY" ||
    (baseline === "ESTIMATED" &&
      (f.values.importChoice ?? f.values.importPosition) === "yes");
  return (
    <fieldset className="stack">
      <legend>Opening allocation</legend>
      <Select
        f={f}
        name="baseline"
        label="Benchmark basis"
        options={[
          ["PRE_ENTRY_VERIFIED", "Verified pre-entry holdings"],
          ["POST_ENTRY_ONLY", "Import existing LP position"],
          ["ESTIMATED", "Estimated opening allocation"],
        ]}
      />
      {baseline === "ESTIMATED" && (
        <Select
          f={f}
          name="importChoice"
          label="Starting holdings"
          options={[
            ["no", "Wallet only"],
            ["yes", "Wallet plus an existing position"],
          ]}
        />
      )}
      <input
        type="hidden"
        name="importPosition"
        value={importing ? "yes" : "no"}
      />
      <div className="field-grid">
        {tokens(market).map((t, i) => (
          <Text
            key={i}
            f={f}
            name={`wallet${i}`}
            label={`Wallet · ${t.symbol}`}
            number
            hint="Blank means no allocation of this asset."
          />
        ))}
      </div>
      {importing && (
        <>
          <p className="alert">
            Starting capital is the sum of observed wallet, principal, and
            pre-existing unclaimed fees. No earlier swaps are inferred.
          </p>
          <LegFields f={f} market={market} protocol={protocol} />
          <PositionFields f={f} market={market} />
        </>
      )}
    </fieldset>
  );
}

function MetadataFields({ f }: { f: FieldsApi }) {
  return (
    <>
      <div className="field-grid">
        <Text f={f} name="name" label="Strategy name" />
        <Text f={f} name="protocol" label="Protocol / version" />
        <Text f={f} name="walletAddress" label="Wallet address (optional)" />
        <Text
          f={f}
          name="positionRef"
          label="Linked position reference (optional)"
        />
      </div>
      <Notes f={f} name="strategyNotes" label="Strategy notes" />
    </>
  );
}

function configured(values: Fields): Market | undefined {
  if (values.preset === "base" || values.preset === "ethereum")
    return presets[values.preset];
  if (values.preset !== "custom") return undefined;
  const chainId = values.chainId || "1";
  const native = {
    id: `${chainId}:native`,
    symbol: values.nativeSymbol || "Native",
    decimals: 18,
  };
  const token = (i: number): Token =>
    values[`address${i}`]?.toLowerCase() === "native"
      ? native
      : {
          id: `${chainId}:${values[`address${i}`]?.toLowerCase() || `token${i}`}`,
          symbol: values[`symbol${i}`] || `Token ${i}`,
          decimals: 18,
        };
  return {
    chainId,
    network: values.network || "Custom",
    native,
    pair: [token(0), token(1)],
  };
}

export function OpenEditor({
  initial,
  zone,
}: {
  initial: Fields;
  zone: string;
}) {
  const f = useFields(initial);
  const [state, submit, busy] = useEditorAction(openCycle);
  const market = configured(f.values);
  return (
    <form method="post" onSubmit={submit} className="stack">
      <input type="hidden" name="command" value={initial.command} />
      <fieldset className="stack">
        <legend>01 / Market and identity</legend>
        <Select
          f={f}
          name="preset"
          label="Network and pair"
          options={[
            ["", "Select the actual network"],
            ["base", "Base · WETH / cbBTC"],
            ["ethereum", "Ethereum · WETH / cbBTC"],
            ["custom", "Custom EVM network or pair"],
          ]}
        />
        {f.values.preset === "custom" && (
          <div className="stack">
            <div className="field-grid">
              <Text f={f} name="network" label="Network name" />
              <Text f={f} name="chainId" label="EVM chain ID" number />
              <Text f={f} name="nativeSymbol" label="Native symbol" />
              <Text
                f={f}
                name="nativeDecimals"
                label="Native decimals"
                number
              />
            </div>
            {[0, 1].map((i) => (
              <div className="field-grid" key={i}>
                <Text
                  f={f}
                  name={`address${i}`}
                  label={`Token ${i} contract or native`}
                />
                <Text f={f} name={`symbol${i}`} label={`Token ${i} symbol`} />
                <Text
                  f={f}
                  name={`decimals${i}`}
                  label={`Token ${i} decimals`}
                  number
                />
                <Select
                  f={f}
                  name={`wrapped${i}`}
                  label={`Token ${i} wraps native`}
                  options={[
                    ["false", "No"],
                    ["true", "Yes, 1:1 wrap"],
                  ]}
                />
              </div>
            ))}
          </div>
        )}
        <MetadataFields f={f} />
        <TimeField f={f} zone={zone} label="Opening date and time" />
      </fieldset>
      {market && (
        <>
          <OpeningFields f={f} market={market} protocol={f.values.protocol} />
          <PricingFields f={f} market={market} zone={zone} />
        </>
      )}
      <label>
        <input type="checkbox" name="independent" value="yes" /> I confirm these
        holdings are not allocated to another strategy.
      </label>
      <Preview state={state} market={market} />
      <Submit busy={busy} label="Create strategy" />
    </form>
  );
}

function MovementFields({
  f,
  market,
  dir,
  single,
}: {
  f: FieldsApi;
  market: Market;
  dir: "in" | "out";
  single?: boolean;
}) {
  const rows = single
    ? 1
    : Math.max(1, Math.min(4, Number(f.values[`${dir}Rows`] || "1")));
  const title = dir === "in" ? "Sent" : "Received";
  return (
    <fieldset className="stack">
      <legend>
        {title} from {dir === "in" ? "the wallet" : "this event"}
      </legend>
      <input type="hidden" name={`${dir}Rows`} value={rows} />
      {Array.from({ length: rows }, (_, i) => (
        <div className="field-grid" key={i}>
          <Select
            f={f}
            name={`${dir}Asset${i}`}
            label={`${title} asset ${i + 1}`}
            options={assetOptions(market)}
            fallback={market.pair[dir === "in" ? 0 : 1].id}
          />
          <Text
            f={f}
            name={`${dir}Amount${i}`}
            label={`${title} amount ${i + 1}`}
            number
          />
        </div>
      ))}
      {!single && rows < 4 && (
        <div>
          <Button
            type="button"
            tone="outline"
            onClick={() => f.set(`${dir}Rows`, String(rows + 1))}
          >
            <Plus size={14} aria-hidden="true" /> Add{" "}
            {dir === "in" ? "input" : "output"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function Expenses({ f, market }: { f: FieldsApi; market: Market }) {
  const rows = Math.max(1, Math.min(4, Number(f.values.costRows || "1")));
  return (
    <fieldset className="stack">
      <legend>Execution expenses</legend>
      <Select
        f={f}
        name="gas"
        label="Network fee coverage"
        options={[
          ["", "Select coverage"],
          ["NONE", "No network fee to record"],
          ["RECORDED", "Record actual total"],
          ["SHARED", "Already linked to the same transaction hash"],
          ["UNKNOWN", "Unresolved network fee"],
        ]}
      />
      {f.values.gas === "RECORDED" && (
        <div className="field-grid">
          <Select
            f={f}
            name="gasAsset"
            label="Network fee asset"
            fallback={market.native.id}
            options={assetOptions(market)}
          />
          <Text
            f={f}
            name="gasAmount"
            label="Total network fee quantity"
            number
            hint="Include applicable L2 fees once. Do not enter both total and components."
          />
          <Select
            f={f}
            name="gasFunding"
            label="Network fee funding"
            options={gasFunding}
          />
        </div>
      )}
      <details
        className="form-details"
        open={
          f.values.kind === "OTHER_EXPENSE" ||
          Object.keys(f.values).some(
            (k) => k.startsWith("costAmount") && f.values[k],
          ) ||
          undefined
        }
      >
        <summary>Independent additional expenses</summary>
        <p className="muted">
          Do not repeat the embedded swap fee or the total network fee here.
        </p>
        <input type="hidden" name="costRows" value={rows} />
        {Array.from({ length: rows }, (_, i) => (
          <div className="field-grid" key={i}>
            <Select
              f={f}
              name={`costCategory${i}`}
              label={`Expense ${i + 1} category`}
              options={simple(["OTHER", "PROTOCOL_FEE", "BRIDGE_FEE"])}
            />
            <Select
              f={f}
              name={`costAsset${i}`}
              label={`Expense ${i + 1} asset`}
              options={[...assetOptions(market), [USD_CASH, "USD cash"]]}
            />
            <Text
              f={f}
              name={`costAmount${i}`}
              label={`Expense ${i + 1} quantity`}
              number
            />
            <Select
              f={f}
              name={`costFunding${i}`}
              label={`Expense ${i + 1} funding`}
              options={gasFunding}
            />
          </div>
        ))}
        {rows < 4 && (
          <Button
            type="button"
            tone="outline"
            onClick={() => f.set("costRows", String(rows + 1))}
          >
            Add expense
          </Button>
        )}
      </details>
    </fieldset>
  );
}

export function EventEditor({
  initial,
  market,
  protocol,
  legs,
  zone,
  correction,
}: {
  initial: Fields;
  market: Market;
  protocol: string;
  legs: Option[];
  zone: string;
  correction?: { id: string; version: number };
}) {
  const f = useFields(initial);
  const [state, submit, busy] = useEditorAction(writeEvent);
  const kind = f.values.kind || "SWAP";
  const legEvent = [
    "ADD_LIQUIDITY",
    "REMOVE_LIQUIDITY",
    "COLLECT_FEES",
    "POSITION_SNAPSHOT",
  ].includes(kind);
  const simpleEvent = [
    "OPENING_ALLOCATION",
    "POSITION_SNAPSHOT",
    "CLOSE_STRATEGY",
  ].includes(kind);
  const legOptions: Option[] = [
    ...(kind === "ADD_LIQUIDITY"
      ? [["new", "Open a new LP leg"] as Option]
      : []),
    ...legs,
  ];
  const legId = legOptions.some(([id]) => id === f.values.legId)
    ? f.values.legId
    : (legOptions[0]?.[0] ?? "");
  return (
    <form method="post" onSubmit={submit} className="stack">
      <input type="hidden" name="command" value={initial.command} />
      <input type="hidden" name="strategyId" value={initial.strategyId} />
      {correction ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="eventId" value={correction.id} />
          <input type="hidden" name="version" value={correction.version} />
          <Text f={f} name="revisionReason" label="Audit reason" />
        </>
      ) : (
        <Select
          f={f}
          name="kind"
          label="Event type"
          options={selections(eventNames).filter(
            ([key]) => key !== "OPENING_ALLOCATION",
          )}
        />
      )}
      <TimeField f={f} zone={zone} />
      {kind === "OPENING_ALLOCATION" && (
        <OpeningFields f={f} market={market} protocol={protocol} />
      )}
      {(kind === "SWAP" || kind === "WRAP_UNWRAP") && (
        <>
          {kind === "SWAP" && (
            <Select
              f={f}
              name="purpose"
              label="Swap purpose"
              options={simple(["ENTRY", "EXIT", "REBALANCE", "OTHER"])}
            />
          )}
          <div className="split">
            <MovementFields
              f={f}
              market={market}
              dir="in"
              single={kind === "WRAP_UNWRAP"}
            />
            <MovementFields
              f={f}
              market={market}
              dir="out"
              single={kind === "WRAP_UNWRAP"}
            />
          </div>
        </>
      )}
      {legEvent && (
        <>
          <label className="field">
            LP leg
            <select
              name="legId"
              value={legId}
              onChange={(e) => f.set("legId", e.target.value)}
            >
              {!legOptions.length && <option value="">No LP leg yet</option>}
              {legOptions.map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {kind === "ADD_LIQUIDITY" && (
            <>
              {legId === "new" && (
                <LegFields f={f} market={market} protocol={protocol} />
              )}
              <PairFields
                f={f}
                market={market}
                stem="deposit"
                label="Deposited"
              />
            </>
          )}
          {kind === "REMOVE_LIQUIDITY" && (
            <>
              <PairFields
                f={f}
                market={market}
                stem="receipt"
                label="Total received"
              />
              <PairFields
                f={f}
                market={market}
                stem="withdraw"
                label="Principal received"
              />
            </>
          )}
          {(kind === "REMOVE_LIQUIDITY" || kind === "COLLECT_FEES") && (
            <PairFields
              f={f}
              market={market}
              stem="fee"
              label="Fees received"
            />
          )}
          {kind !== "POSITION_SNAPSHOT" && (
            <Select
              f={f}
              name="observe"
              label="Post-event snapshot"
              options={[
                ["record", "Record observed balances"],
                ["omit", "No snapshot yet · mark incomplete"],
              ]}
            />
          )}
          {(kind === "POSITION_SNAPSHOT" || f.values.observe !== "omit") && (
            <PositionFields f={f} market={market} />
          )}
        </>
      )}
      {!simpleEvent && (
        <>
          <Expenses f={f} market={market} />
          <details className="form-details">
            <summary>Transaction identifiers and workflow</summary>
            <div className="field-grid">
              <Text f={f} name="txHash" label="Transaction hash (optional)" />
              <Text
                f={f}
                name="actionIndex"
                label="Action index (required with hash)"
                number
              />
              <Text
                f={f}
                name="group"
                label="Group / rebalance label (optional)"
              />
            </div>
          </details>
        </>
      )}
      {kind === "CLOSE_STRATEGY" && (
        <p className="alert warn">
          Closure requires known-zero principal and pending fees. It freezes the
          current ledger, market references, and performance. Closed cycles
          cannot be reopened.
        </p>
      )}
      <PricingFields
        f={f}
        market={market}
        zone={zone}
        keep={Boolean(correction)}
      />
      <Notes f={f} />
      <Preview state={state} market={market} />
      <Submit
        busy={busy}
        label={
          correction
            ? "Post correction"
            : kind === "CLOSE_STRATEGY"
              ? "Freeze and close"
              : "Post event"
        }
        draft={!correction && kind !== "CLOSE_STRATEGY"}
        danger={kind === "CLOSE_STRATEGY"}
      />
    </form>
  );
}

export function MarkEditor({
  initial,
  market,
  zone,
}: {
  initial: Fields;
  market: Market;
  zone: string;
}) {
  const f = useFields(initial);
  const [state, submit, busy] = useEditorAction(updateMark);
  return (
    <form method="post" onSubmit={submit} className="stack">
      <input type="hidden" name="command" value={initial.command} />
      <input type="hidden" name="strategyId" value={initial.strategyId} />
      <Select
        f={f}
        name="markMode"
        label="Reference time"
        options={[
          ["latest", "Now · latest prices"],
          ["historical", "A specific valuation time"],
        ]}
      />
      {f.values.markMode === "historical" && (
        <TimeField f={f} zone={zone} label="Reference date and time" />
      )}
      <PricingFields f={f} market={market} zone={zone} />
      <Preview state={state} market={market} />
      <Submit busy={busy} label="Save valuation mark" />
    </form>
  );
}

export function MetadataEditor({
  initial,
  children,
}: {
  initial: Fields;
  children?: ReactNode;
}) {
  const f = useFields(initial);
  const [state, submit, busy] = useEditorAction(updateMetadata);
  return (
    <form method="post" onSubmit={submit} className="stack">
      <input type="hidden" name="strategyId" value={initial.strategyId} />
      <MetadataFields f={f} />
      {children}
      <Preview state={state} />
      <Submit busy={busy} label="Save metadata" preview={false} />
    </form>
  );
}
