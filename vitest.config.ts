import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig "@/*" path alias so unit tests resolve imports the
// same way the Next.js build does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Next compiles JSX with the automatic runtime; tests do the same.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
  },
});
