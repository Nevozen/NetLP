import Link from "next/link";
import { get, type Query } from "@/components/filters";
import { activity, JournalTable, pairName } from "@/components/reports";
import { Button, PageHeader, Panel } from "@/components/ui";
import { eventNames } from "@/domain/presentation";
import { getWorkspace } from "@/server/workspace";

export const metadata = { title: "Transactions" };

export default async function Transactions({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { user, journal } = await getWorkspace();
  const [cycles, q] = await Promise.all([journal.list(user.id), searchParams]);
  const open = cycles.filter((c) => !c.closedAt);
  const search = get(q, "q").trim().toLowerCase();
  const all = activity(cycles).filter(
    ({ cycle, line: { entry } }) =>
      (!get(q, "strategy") || get(q, "strategy") === cycle.id) &&
      (!get(q, "kind") || get(q, "kind") === entry.facts.kind) &&
      (!search ||
        [
          entry.facts.notes,
          entry.facts.txHash,
          entry.facts.group,
          cycle.name,
          pairName(cycle.market),
          eventNames[entry.facts.kind],
        ].some((text) => text?.toLowerCase().includes(search))),
  );
  const page = /^\d{1,5}$/.test(get(q, "page"))
    ? Math.max(1, Number(get(q, "page")))
    : 1;
  const paramsFor = (p: number) =>
    `/transactions?${new URLSearchParams({ q: get(q, "q"), kind: get(q, "kind"), strategy: get(q, "strategy"), page: String(p) })}`;
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / 03"
        title="Transactions"
        actions={
          <Button asChild>
            <Link
              href={
                open.length === 1
                  ? `/positions/${open[0].id}/event`
                  : "/positions"
              }
            >
              Record transaction
            </Link>
          </Button>
        }
      >
        A chronological journal of what moved, what it cost, and how each event
        was priced.
      </PageHeader>
      <Panel title="Posted journal">
        <form className="filter" method="get">
          <label className="field">
            Search
            <input
              type="search"
              name="q"
              defaultValue={get(q, "q")}
              placeholder="Notes, group, or transaction hash"
            />
          </label>
          <label className="field">
            Strategy
            <select name="strategy" defaultValue={get(q, "strategy")}>
              <option value="">All</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Event type
            <select name="kind" defaultValue={get(q, "kind")}>
              <option value="">All</option>
              {Object.entries(eventNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <Button type="submit" tone="outline">
              Apply filters
            </Button>
          </div>
        </form>
        <JournalTable
          items={all.slice((page - 1) * 50, page * 50)}
          zone={user.settings.timezone}
        />
        {(page > 1 || all.length > 50) && (
          <div className="actions">
            <span>Page {page}</span>
            {page > 1 && (
              <Link className="link" href={paramsFor(page - 1)}>
                Previous
              </Link>
            )}
            {all.length > page * 50 && (
              <Link className="link" href={paramsFor(page + 1)}>
                Next
              </Link>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
