import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/sharing_test")
  throw new Error("E2E requires sharing_test.");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  APP_URL: "http://localhost:3103",
  BETTER_AUTH_URL: "http://localhost:3103",
  MCP_RESOURCE_URL: "http://localhost:3103/mcp",
  LOG_LEVEL: "silent",
});
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:3103",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3103",
    url: "http://localhost:3103/sign-in",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
