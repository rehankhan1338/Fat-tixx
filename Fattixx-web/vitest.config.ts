import { defineConfig } from "vitest/config";
import path from "node:path";
const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `import 'server-only'` throws outside React Server Components; tests run in plain Node.
      "server-only": path.resolve(root, "tests/unit/_stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/_setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    // Integration files share the fattixx_test database; running them side by side causes lock contention between files.
    fileParallelism: false,
  },
});
