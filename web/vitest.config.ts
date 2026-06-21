import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    css: false,
  },
  // The enemy tests are pure logic — skip the app's Tailwind/PostCSS pipeline.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
