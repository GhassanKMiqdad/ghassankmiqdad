import path from "node:path";

import { defineConfig } from "vitest/config";

// API security suite against a running Supabase stack (see tests/integration).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One fixture, executed in declaration order.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
