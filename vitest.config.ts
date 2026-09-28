import { defineConfig } from "vitest/config";

// No plugins needed: the current test suite only exercises plain .ts
// crypto/data modules, never .vue single-file components.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
