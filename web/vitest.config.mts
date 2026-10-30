import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The model performance test needs the CPU to itself; other files would
    // compete with it when Vitest runs them in parallel.
    fileParallelism: false,
  },
});
