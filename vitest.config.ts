import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({ quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== "/sharing_test")
  throw new Error("Tests require the isolated sharing_test database.");
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    env: {
      DATABASE_URL: testUrl,
      BETTER_AUTH_URL: "http://localhost:3101",
      APP_URL: "http://localhost:3101",
      MCP_RESOURCE_URL: "http://localhost:3101/mcp",
      LOG_LEVEL: "silent",
    },
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
