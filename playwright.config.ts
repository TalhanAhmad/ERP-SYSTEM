import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://encova:local_only@localhost:55432/encova_test",
      BETTER_AUTH_URL: baseURL,
      APP_URL: baseURL,
      AUTH_PROVIDER: "better-auth",
    },
    timeout: 60000,
  },
});
