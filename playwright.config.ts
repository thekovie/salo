import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Every browser starts as someone who has already seen the first-time tour offer, so it never shifts what other
    // tests click. onboarding.spec.ts opens clean contexts to test the offer itself.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${PORT}`,
          localStorage: [
            { name: "salo:tour:host:v1", value: "1" },
            { name: "salo:tour:guest:v1", value: "1" },
          ],
        },
      ],
    },
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // POSTHOG_KEY empty: tests never send analytics, even if a developer's .env has the real key.
    env: { APP_URL: `http://localhost:${PORT}`, NEW_ORDERS_PER_HOUR: "1000", POSTHOG_KEY: "", DATABASE_URL: process.env.DATABASE_URL ?? "postgres://salo@localhost:5433/salo" },
  },
});
