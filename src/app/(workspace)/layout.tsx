import type { ReactNode } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { AccountNavigation, Navigation } from "@/components/navigation";
import { Brand } from "@/components/ui";
import { denominations } from "@/domain/catalog";
import { requireUser } from "@/server/session";
import { setPreferences } from "../actions";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="workspace" data-theme={user.settings.theme}>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" aria-label="LPStacks home">
          <Brand />
        </Link>
        <p className="sidebar-label">WORKSPACE</p>
        <Navigation />
        <div className="sidebar-foot">
          <AccountNavigation />
          <div className="profile">
            <span>{user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <small>Private journal</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="canvas">
        <header className="toolbar">
          <span className="workspace-caption">
            <LockKeyhole size={15} aria-hidden="true" /> Private workspace
          </span>
          <form
            className="denominations"
            action={setPreferences}
            aria-label="Reporting denomination"
          >
            {denominations.map((den) => (
              <button
                key={den}
                name="denomination"
                value={den}
                aria-pressed={user.settings.denomination === den}
              >
                {den}
              </button>
            ))}
          </form>
        </header>
        <main id="content" className="content">
          {children}
        </main>
        <footer className="footer">
          <span>LPStacks / Wardana Dev</span>
          <span>Reference estimates. Not investment or tax advice.</span>
        </footer>
      </div>
    </div>
  );
}
