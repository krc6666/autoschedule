import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["@autoschedule/highs-ts", "@bubblyworld/highs-ts"],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
