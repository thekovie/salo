import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Services read the validated environment; tests point it at the integration database.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://salo@localhost:5433/salo_test",
      APP_URL: "http://localhost:3000",
    },
    // Integration tests share one Postgres database and truncate it between tests.
    fileParallelism: false,
    coverage: { provider: "v8", include: ["src/server/**", "src/lib/**", "src/env.ts"] },
  },
});
