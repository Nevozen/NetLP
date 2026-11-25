"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  importWalletActivity,
  pauseWallet,
  saveWallet,
} from "@/app/wallet-actions";
import { Button } from "./ui";

const syncRequest = async (signal?: AbortSignal) => {
  const response = await fetch("/api/imports/sync", {
    method: "POST",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Sync unavailable.");
  return (await response.json()) as { updatedAt: number; busy: boolean };
};

const SyncVersion = createContext(0);

export function WalletPoller({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let abort: AbortController | null = null;
    let stopped = false;
    let timer: number | undefined;
    const stop = () => {
      window.clearTimeout(timer);
      abort?.abort();
    };
    const poll = async () => {
      if (stopped || document.hidden || abort) return;
      const request = new AbortController();
      abort = request;
      let delay = 30_000;
      try {
        const { updatedAt, busy } = await syncRequest(request.signal);
        if (!stopped && !busy) setVersion((prev) => Math.max(prev, updatedAt));
        if (busy) delay = 2000;
      } catch {
        // A later visible poll or Sync now can retry.
      } finally {
        abort = null;
        if (!stopped && !document.hidden) {
          timer = window.setTimeout(poll, request.signal.aborted ? 0 : delay);
        }
      }
    };
    const visibility = () => (document.hidden ? stop() : void poll());
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);
  return (
    <SyncVersion.Provider value={version}>{children}</SyncVersion.Provider>
  );
}

export function SyncNow({
  enabled,
  updatedAt,
}: {
  enabled: boolean;
  updatedAt: number;
}) {
  const router = useRouter();
  const syncedAt = useContext(SyncVersion);
  useEffect(() => {
    if (syncedAt > updatedAt) router.refresh();
  }, [router, syncedAt, updatedAt]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="actions">
      <Button
        type="button"
        tone="outline"
        disabled={busy || !enabled}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await syncRequest();
            router.refresh();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Syncing…" : "Sync now"}
      </Button>
      {error && (
        <small role="alert">Sync is unavailable. Try again later.</small>
      )}
    </div>
  );
}

export function WalletSettings({
  watched,
  enabled,
  canSync,
  canVerify,
}: {
  watched: string;
  enabled: boolean;
  canSync: boolean;
  canVerify: boolean;
}) {
  const [state, save, busy] = useActionState(saveWallet, {});
  return (
    <div className="stack">
      <p className="muted">
        Use a public Base address only. LPStacks sends it to the configured data
        provider to find wallet activity. No wallet connection or signing is
        required.
      </p>
      <div className="chips">
        <span className="badge">
          {canSync
            ? enabled
              ? "Automatic sync enabled"
              : "Automatic sync paused"
            : "Automatic sync not configured"}
        </span>
        <span className="badge">
          {canVerify
            ? "CSV and hash verification available"
            : "Base RPC not configured"}
        </span>
      </div>
      <form className="stack" action={save}>
        <label className="field">
          Public wallet address
          <input
            name="address"
            key={watched}
            maxLength={42}
            minLength={42}
            required
            defaultValue={watched}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          Start discovery
          <select name="recent" defaultValue="yes">
            <option value="yes">Recent 10,000 blocks</option>
            <option value="no">From first successful sync</option>
          </select>
          <small>
            Changing the address starts a new scan. Saving the same address
            keeps its current progress.
          </small>
        </label>
        {state.error && <p role="alert">{state.error}</p>}
        {state.message && <p role="status">{state.message}</p>}
        <div className="actions">
          <Button disabled={busy} type="submit">
            Save Base wallet
          </Button>
        </div>
      </form>
      {watched && canSync && (
        <form className="actions" action={pauseWallet}>
          <input type="hidden" name="pause" value={enabled ? "yes" : "no"} />
          <Button type="submit" tone="outline">
            {enabled ? "Pause sync" : "Resume sync"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function WalletImportForm({ enabled }: { enabled: boolean }) {
  const [state, dispatch, busy] = useActionState(importWalletActivity, {});
  return (
    <form className="stack" action={dispatch}>
      <div className="field-grid">
        <label className="field">
          BaseScan CSV file
          <input
            name="csv"
            type="file"
            accept=".csv,text/csv"
            disabled={!enabled || busy}
          />
          <small>
            Only transaction hashes are read; up to 500 hashes or 512 KB.
          </small>
        </label>
        <label className="field">
          Transaction hash
          <input
            name="hash"
            maxLength={66}
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            disabled={!enabled || busy}
          />
          <small>
            Use a file or a hash. Receipts are checked against your watched
            address.
          </small>
        </label>
      </div>
      <div className="actions">
        <Button type="submit" tone="outline" disabled={!enabled || busy}>
          {busy ? "Verifying…" : "Import CSV or hash"}
        </Button>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}

export function SelectionButton({
  form = "wallet-selection",
}: {
  form?: string;
}) {
  const [countError, setCountError] = useState(false);
  const check = (event: FormEvent<HTMLButtonElement>) => {
    const targetForm = event.currentTarget.form;
    if (!targetForm) return;
    const count = new FormData(targetForm).getAll("activity").length;
    if (count >= 1 && count <= 10) return;
    event.preventDefault();
    setCountError(true);
  };
  return (
    <div className="actions">
      <Button type="submit" form={form} onClick={check}>
        Review selected transactions
      </Button>
      {countError && (
        <small role="alert">
          Select between 1 and 10 eligible transactions.
        </small>
      )}
    </div>
  );
}
