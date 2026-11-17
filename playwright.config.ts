import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["phoenix_core_dashboard.spec.ts"],
  timeout: 120_000,
  workers: 1,
  use: {
    viewport: { width: 1500, height: 960 },
    headless: true,
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  reporter: "list",
});
