import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["dist/**", "generated/**", "node_modules/**"],
    setupFiles: ["tests/setupEnv.ts"],
  },
});
