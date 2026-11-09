import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
const storagePort = Number(process.env.PLAYWRIGHT_STORAGE_PORT ?? port + 1);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 90000,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/storage-fixture.ts",
      url: `http://127.0.0.1:${storagePort}/health`,
      reuseExistingServer: false,
      env: { PLAYWRIGHT_STORAGE_PORT: String(storagePort) },
      timeout: 20000,
    },
    {
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
        SUPABASE_URL: `http://127.0.0.1:${storagePort}`,
        SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
        SUPABASE_SECRET_KEY: "synthetic-storage-server-key",
      },
      timeout: 60000,
    },
  ],
});
