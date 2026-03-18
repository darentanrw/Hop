import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/web/tests/**/*.test.ts", "services/matcher/src/**/*.test.ts"],
  },
});
