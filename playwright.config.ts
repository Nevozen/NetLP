import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { isolatedDatabase } from "./tests/test-db";

const url = "http://127.0.0.1:3167";
const database = isolatedDatabase("e2e");
const secret = randomBytes(32).toString("hex");

process.env.DATABASE_URL = database;
process.env.BETTER_AUTH_URL = url;
process.env.BETTER_AUTH_SECRET = secret;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 75_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: url,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: `${url}/login`,
    timeout: 35_000,
    env: {
      DATABASE_URL: database,
      BETTER_AUTH_URL: url,
      BETTER_AUTH_SECRET: secret,
      HOSTNAME: "127.0.0.1",
      PORT: "3167",
      ALCHEMY_API_KEY: "lpstacks_browser_fixture",
      BASE_RPC_URL: "",
      NODE_OPTIONS: `--import "${new URL("./tests/e2e/base-provider.mjs", import.meta.url).href}"`,
    },
  },
});
