import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://encova:local_only@localhost:55432/encova_test",
      BETTER_AUTH_URL: "http://localhost:3000",
    },
    timeout: 60000,
  },
});
