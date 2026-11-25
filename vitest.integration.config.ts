import { defineConfig } from "vitest/config";
import unit from "./vitest.config";

export default defineConfig({
  ...unit,
  test: {
    ...unit.test,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
