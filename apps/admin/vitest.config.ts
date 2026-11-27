import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Lets tests import modules that use the "@/" alias and compile JSX with the automatic runtime.
// The environment stays node; component and hook tests opt into jsdom per file.
export default defineConfig({
  test: { globalSetup: ["./test/globalSetup.ts"], setupFiles: ["./test/resetCache.ts"] },
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
