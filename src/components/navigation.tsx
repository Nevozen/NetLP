"use client";

import {
  Activity,
  Boxes,
  ChartNoAxesCombined,
  LayoutGrid,
  LogOut,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const sections = [
  ["/", "Overview", LayoutGrid],
  ["/positions", "Positions", Boxes],
  ["/transactions", "Transactions", Activity],
  ["/analytics", "Analytics", ChartNoAxesCombined],
] as const;

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="nav">
      {sections.map(([url, text, Icon]) => {
        const active =
          url === "/" ? pathname === url : pathname.startsWith(url);
        return (
          <Link key={url} href={url} aria-current={active ? "page" : undefined}>
            <Icon size={18} aria-hidden="true" />
            <span>{text}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AccountNavigation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="account-nav">
      <Link href="/settings" className="bare">
        <Settings2 size={17} aria-hidden="true" /> Settings
      </Link>
      <button
        className="bare"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const response = await fetch("/api/auth/sign-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!response.ok) throw new Error("Sign-out failed");
            router.replace("/login");
            router.refresh();
          } catch {
            setBusy(false);
            setError(true);
          }
        }}
      >
        <LogOut size={17} aria-hidden="true" />{" "}
        {busy ? "Signing out..." : "Sign out"}
      </button>
      {error && <small role="alert">Sign-out failed. Try again.</small>}
    </div>
  );
}
