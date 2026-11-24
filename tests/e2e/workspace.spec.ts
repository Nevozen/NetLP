import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { presets } from "../../src/domain/catalog";
import { makeAuth } from "../../src/server/auth";
import { database } from "../../src/server/db";
import { createJournal } from "../../src/server/journal";

const testPassphrase = "synthetic-browser-test-credential";
const owner1 = `${randomUUID()}@example.test`;
const owner2 = `${randomUUID()}@example.test`;
const referenceDate = (minute: number) =>
  `2025-02-01T10:${String(minute).padStart(2, "0")}`;

test.beforeAll(async () => {
  const auth = makeAuth(true);
  for (const [number, email] of [owner1, owner2].entries()) {
    await auth.api.signUpEmail({
      body: {
        name: `Test owner ${number + 1}`,
        email,
        password: testPassphrase,
      },
    });
  }
});
test.afterAll(() => database().$disconnect());

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(testPassphrase);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

async function prices(
  page: Page,
  mode: "MANUAL" | "MISSING" = "MANUAL",
  weth = "2500",
  cbBTC = "100000",
  eth = "2500",
) {
  for (const [token, value] of [
    ["WETH", weth],
    ["cbBTC", cbBTC],
    ["ETH", eth],
  ]) {
    await page
      .getByLabel(`${token} price mode`, { exact: true })
      .selectOption(mode);
    if (mode === "MANUAL")
      await page.getByLabel(`${token} USD price`, { exact: true }).fill(value);
  }
  if (mode === "MANUAL") {
    await page
      .getByLabel("Independent price source")
      .fill("Synthetic test quote");
    await page
      .getByLabel("Manual price reason")
      .fill("Playwright acceptance fixture");
  }
}

async function event(page: Page, url: string, type: string, minute: number) {
  await page.goto(`${url}/event?type=${type}`);
  await page.getByLabel(/^Event date and time/).fill(referenceDate(minute));
  await expect(page.getByLabel("Event type")).toHaveValue(type);
}

async function submit(page: Page, button = "Post event") {
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page).toHaveURL(/\/positions\/[a-f0-9-]+$/, { timeout: 15_000 });
}

async function observed(
  page: Page,
  weth: string,
  btc: string,
  pendingWeth = "0",
  pendingBtc = "0",
) {
  for (const [label, value] of [
    ["Principal · WETH", weth],
    ["Principal · cbBTC", btc],
    ["Unclaimed fees · WETH", pendingWeth],
    ["Unclaimed fees · cbBTC", pendingBtc],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
}

test("manual journal from entry swap to frozen closure, with analytics and CSV", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  const publicExport = await page.request.get(
    `/positions/${randomUUID()}/export`,
  );
  expect(publicExport.status()).toBe(401);
  expect(
    (await page.request.post("/api/auth/sign-up/email", { data: {} })).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        form: { email: owner1, password: testPassphrase },
      })
    ).status(),
  ).toBe(415);
  await signIn(page, owner1);
  await expect(
    page.getByText("Waiting for an opening allocation"),
  ).toBeVisible();
  await page.getByRole("link", { name: "New strategy" }).click();
  await page.getByLabel("Network and pair").selectOption("base");
  await page.getByLabel("Strategy name").fill("WETH accumulation test");
  await page
    .getByLabel("Protocol / version", { exact: true })
    .fill("Test concentrated LP");
  await page.getByLabel(/^Opening date and time/).fill(referenceDate(0));
  await page.getByLabel(/^Wallet · WETH/).fill("0.4");
  await page.getByLabel("Strategy notes").fill("=synthetic formula text");
  await prices(page);
  await page.getByRole("checkbox").check();
  await submit(page, "Create strategy");
  const cycle = new URL(page.url()).pathname;

  await event(page, cycle, "SWAP", 1);
  await page.getByLabel("Sent amount 1").fill("0.2");
  await page.getByLabel("Received amount 1").fill("0.0049");
  await page.getByLabel("Network fee coverage").selectOption("RECORDED");
  await page.getByLabel(/^Total network fee quantity/).fill("0.00008");
  await prices(page);
  await page.getByRole("button", { name: "Preview accounting" }).click();
  await expect(page.getByText(/Execution shortfall \+\$10\.00/)).toBeVisible();
  await submit(page);

  await event(page, cycle, "ADD_LIQUIDITY", 2);
  await page.getByLabel("Deposited · WETH").fill("0.2");
  await page.getByLabel("Deposited · cbBTC").fill("0.0049");
  await observed(page, "0.2", "0.0049");
  await page.getByLabel("Network fee coverage").selectOption("NONE");
  await prices(page);
  await submit(page);

  await event(page, cycle, "POSITION_SNAPSHOT", 3);
  await observed(page, "0.2", "0.0049", "0", "0.0002");
  await prices(page);
  await submit(page);

  await event(page, cycle, "COLLECT_FEES", 4);
  await page.getByLabel("Fees received · cbBTC").fill("0.0002");
  await observed(page, "0.2", "0.0049");
  await page.getByLabel("Network fee coverage").selectOption("NONE");
  await prices(page);
  await submit(page);

  await event(page, cycle, "REMOVE_LIQUIDITY", 5);
  for (const [label, value] of [
    ["Total received · WETH", "0.2"],
    ["Total received · cbBTC", "0.0049"],
    ["Principal received · WETH", "0.2"],
    ["Principal received · cbBTC", "0.0049"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await observed(page, "0", "0");
  await page.getByLabel("Network fee coverage").selectOption("NONE");
  await prices(page);
  await submit(page);

  await event(page, cycle, "SWAP", 6);
  await page.getByLabel("Swap purpose").selectOption("EXIT");
  await page
    .getByLabel("Sent asset 1")
    .selectOption("8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
  await page
    .getByLabel("Received asset 1")
    .selectOption("8453:0x4200000000000000000000000000000000000006");
  await page.getByLabel("Sent amount 1").fill("0.0051");
  await page.getByLabel("Received amount 1").fill("0.202");
  await page.getByLabel("Network fee coverage").selectOption("NONE");
  await prices(page);
  await submit(page);

  await event(page, cycle, "CLOSE_STRATEGY", 7);
  await prices(page);
  await submit(page, "Freeze and close");
  await expect(
    page.getByText("Frozen net wealth", { exact: true }).locator(".."),
  ).toContainText("$1,004.80");
  await expect(
    page.getByText("Outperformance vs HODL", { exact: true }).locator(".."),
  ).toContainText("+$4.80");
  await expect(
    page.getByText("Net claimed fee income", { exact: true }).locator(".."),
  ).toContainText("+$4.80");
  await expect(
    page.getByText("Swap execution shortfall", { exact: true }).locator(".."),
  ).toContainText("+$15.00");
  await page.screenshot({
    path: testInfo.outputPath("strategy-desktop.png"),
    fullPage: true,
  });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("lpstacks-journal.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("'=synthetic formula text");
  expect(csv).toContain('"OUTPERFORMANCE","","","4.8"');
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "WETH accumulation test · LP vs HODL" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Outperformance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Outperformance", exact: true })
    .click();
  await expect(page.getByText(/Gold: LP minus HODL/)).toBeVisible();
});

test("imports an incomplete cycle, corrects historical prices, and isolates owners on mobile", async ({
  page,
}, testInfo) => {
  const client = page.context();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, owner2);
  const foreignOwner = await database().user.findUniqueOrThrow({
    where: { email: owner1 },
  });
  const foreignId = await createJournal(database()).create(
    foreignOwner.id,
    randomUUID(),
    presets.base,
    { name: "Another owner's private cycle", protocol: "Test LP" },
    {
      at: "2025-02-01T02:00:00.000Z",
      prices: [],
      facts: {
        kind: "OPENING_ALLOCATION",
        baseline: "PRE_ENTRY_VERIFIED",
        wallet: { [presets.base.pair[0].id]: "1" },
        gas: "NONE",
        costs: [],
      },
    },
  );
  const foreignUrl = `/positions/${foreignId}`;
  expect((await page.request.get(`${foreignUrl}/export`)).status()).toBe(404);
  await page.goto(foreignUrl);
  await expect(
    page.getByText("Another owner's private cycle", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/positions/new");
  await page.getByLabel("Network and pair").selectOption("ethereum");
  await page.getByLabel("Strategy name").fill("Imported comparison");
  await page
    .getByLabel("Protocol / version", { exact: true })
    .fill("Private LP");
  await page.getByLabel(/^Opening date and time/).fill(referenceDate(0));
  await page.getByLabel("Benchmark basis").selectOption("POST_ENTRY_ONLY");
  await observed(page, "1", "0", "0.01", "0");
  await prices(page, "MISSING");
  await page.getByRole("checkbox").check();
  await submit(page, "Create strategy");
  const url = new URL(page.url()).pathname;
  await expect(page.getByText(/Post-entry comparison/)).toBeVisible();
  await expect(page.getByText(/Unresolved prices or quantities/)).toBeVisible();
  await page
    .getByRole("link", { name: "Opening allocation", exact: true })
    .click();
  await page
    .getByLabel("Audit reason")
    .fill("Add missing independent opening references");
  await prices(page);
  await submit(page, "Post correction");
  await expect(
    page.getByText("Original HODL benchmark", { exact: true }).locator(".."),
  ).toContainText("$2,525.00");

  await page
    .getByRole("link", { name: "Refresh valuation", exact: true })
    .click();
  await prices(page, "MANUAL", "3000", "100000", "3000");
  await submit(page, "Save valuation mark");
  await expect(
    page.getByText("Original HODL benchmark", { exact: true }).locator(".."),
  ).toContainText("$3,030.00");
  await page.getByRole("button", { name: "WETH", exact: true }).click();
  await expect(
    page.getByText("Original HODL benchmark", { exact: true }).locator(".."),
  ).toContainText("1.01000000 WETH");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.goto(url);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("imported-mobile-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await client.request.get(`${url}/export`)).status()).toBe(401);
});
