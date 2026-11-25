import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { presets } from "../../src/domain/catalog";
import { makeAuth } from "../../src/server/auth";
import { database } from "../../src/server/db";
import { createJournal } from "../../src/server/journal";

const wallet = `0x${"a".repeat(40)}`;
const first = `0x${"1".repeat(64)}`;
const second = `0x${"2".repeat(64)}`;
const mint = `0x${"3".repeat(64)}`;
const password = "synthetic-wallet-browser-credential";
const email = `${randomUUID()}@example.test`;
const cycle = randomUUID();
const at = "2025-01-31T00:00:00.000Z";

test.beforeAll(async () => {
  const result = await makeAuth(true).api.signUpEmail({
    body: { name: "Base wallet fixture", email, password },
  });
  await createJournal(database()).create(
    result.user.id,
    cycle,
    presets.base,
    {
      name: "Wallet test strategy",
      protocol: "PancakeSwap v3",
      walletAddress: wallet,
    },
    {
      at,
      facts: {
        kind: "OPENING_ALLOCATION",
        baseline: "PRE_ENTRY_VERIFIED",
        gas: "NONE",
        costs: [],
        wallet: { [presets.base.pair[0].id]: "0.4" },
      },
      prices: [...presets.base.pair, presets.base.native].map(
        ({ id, symbol }) => ({
          asset: id,
          usd: symbol === "cbBTC" ? "100000" : "2500",
          requestedAt: at,
          observedAt: at,
          fetchedAt: at,
          source: "Fixture",
          resolution: "Fixture",
          quality: "MANUAL",
          note: "Fixture market observation",
        }),
      ),
    },
  );
});
test.afterAll(() => database().$disconnect());

test("discovers wallet history, deduplicates CSV and posts a reviewed batch on mobile", async ({
  page,
}) => {
  expect((await page.request.get("/transactions/export")).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(
    (
      await page.request.post("/api/imports/sync", {
        headers: { Origin: "https://example.test" },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/settings");
  await page.getByLabel("Public wallet address").fill(wallet);
  await page.getByRole("button", { name: "Save Base wallet" }).click();
  await expect(page.getByText("Base wallet saved.")).toBeVisible();
  await page.goto("/transactions?view=wallet");
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(
    2,
    { timeout: 30_000 },
  );
  await page
    .getByRole("navigation", { name: "Wallet activity filters" })
    .getByRole("link", { name: "Transactions", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(2);
  await expect(
    page.locator(`a[href="https://basescan.org/tx/${mint}"]`),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "NFT Transfers", exact: true }).click();
  await expect(
    page.locator(`a[href="https://basescan.org/tx/${mint}"]`),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
  await page
    .getByRole("link", { name: "Token Transfers", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(2);
  const text = `\uFEFF"Transaction Hash","Private Notes"\n"${first}","=ignore"\n"${first}","x"\n"bad","y"`;
  await page.getByLabel("BaseScan CSV file").setInputFiles({
    name: "basescan.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Import CSV or hash" }).click();
  await expect(
    page.getByText(/0 queued, 2 duplicates, 1 invalid/),
  ).toBeVisible();
  await page.getByRole("textbox", { name: /^Transaction hash/ }).fill(second);
  await page.getByRole("button", { name: "Import CSV or hash" }).click();
  await expect(
    page.getByText(/0 queued, 1 duplicates, 0 invalid/),
  ).toBeVisible();
  const list = page.getByRole("checkbox", { name: /^Select / });
  await list.first().check();
  await list.last().check();
  await page
    .getByRole("button", { name: "Review selected transactions" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review wallet activity" }),
  ).toBeVisible();
  const rows = page.getByRole("region", { name: /^Review transaction/ });
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await row.getByLabel("Gas funding").selectOption("EXTERNAL");
    await row.getByText("Historical reference prices", { exact: true }).click();
    for (const [symbol, price] of [
      ["WETH", "2500"],
      ["cbBTC", "100000"],
      ["ETH", "2500"],
    ]) {
      await row
        .getByRole("combobox", { name: new RegExp(`^${symbol} price mode`) })
        .selectOption("MANUAL");
      await row.getByLabel(`${symbol} USD price`, { exact: true }).fill(price);
    }
    await row
      .getByLabel("Independent price source")
      .fill("Independent fixture");
    await row
      .getByLabel("Manual price reason")
      .fill("Fixture market observation");
  }
  await page.getByLabel(/These actions/).check();
  await page.getByRole("button", { name: "Preview batch" }).click();
  await expect(
    page.getByRole("heading", { name: "Batch preview" }),
  ).toBeVisible();
  await expect(page.getByText("Net wealth: $974.60")).toBeVisible();
  await page.getByRole("button", { name: "Post selected" }).click();
  await expect(page).toHaveURL(`/positions/${cycle}`);
  const exportCsv = await page.request.get(`/positions/${cycle}/export`);
  expect(await exportCsv.text()).toContain("Base block 100000");
  await page.goto("/transactions?view=wallet");
  await expect(
    page.getByRole("link", { name: "View posted entry" }),
  ).toHaveCount(2);
  const activityCsv = await page.request.get(
    "/transactions/export?category=TOKEN",
  );
  expect(activityCsv.status()).toBe(200);
  const content = await activityCsv.text();
  expect(content).toContain(second);
  expect(content).not.toContain(mint);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});
