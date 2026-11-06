import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one Postgres database and truncate it between tests.
    fileParallelism: false,
    coverage: { provider: "v8", include: ["src/server/**", "src/lib/**", "src/env.ts"] },
  },
});
