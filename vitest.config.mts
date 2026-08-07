import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Vite resolves the "@/*" alias straight from tsconfig.json, so the paths
  // stay defined in exactly one place.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // The resolution logic is what the tests exist to protect. Coverage is
      // reported on it specifically rather than on the whole app, so the number
      // means something instead of being diluted by UI and config files.
      include: ["src/lib/game/**", "src/lib/price/**", "src/lib/db/**"],
    },
  },
});
