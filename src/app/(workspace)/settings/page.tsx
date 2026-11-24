import { setPreferences } from "@/app/actions";
import { Button, PageHeader, Panel } from "@/components/ui";
import { denominations } from "@/domain/catalog";
import { requireUser } from "@/server/session";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const { settings } = await requireUser();
  const cities = [
    ...new Set([
      settings.timezone,
      "UTC",
      "Asia/Jakarta",
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  return (
    <>
      <PageHeader eyebrow="WORKSPACE / ACCOUNT" title="Settings">
        Customize how LPStacks presents your journal.
      </PageHeader>
      <Panel title="Display preferences">
        <form action={setPreferences} className="stack">
          <label className="field">
            Display timezone
            <select name="timezone" defaultValue={settings.timezone}>
              {cities.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </select>
            <small>Journal dates are saved in UTC.</small>
          </label>
          <label className="field">
            Theme
            <select
              name="theme"
              aria-label="Theme"
              defaultValue={settings.theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="field">
            Reporting denomination
            <select name="denomination" defaultValue={settings.denomination}>
              {denominations.map((den) => (
                <option key={den}>{den}</option>
              ))}
            </select>
          </label>
          <div>
            <Button type="submit">Save preferences</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
