import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next aliases the bare "server-only" specifier at build time; plain Node
      // resolution (vitest) can't find it, so point at the shim Next ships. Needed by
      // tests that import a Route Handler, which pulls in server-only lib modules.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
