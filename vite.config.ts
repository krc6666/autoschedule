import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 900
  },
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
