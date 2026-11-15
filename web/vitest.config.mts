import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Server modules import this marker, which throws outside React server code.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The model performance test needs the CPU to itself; other files would
    // compete with it when Vitest runs them in parallel.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // Logic and API routes. Components and pages are not unit tested.
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["**/*.test.ts", "**/test-helpers.ts"],
    },
  },
});
