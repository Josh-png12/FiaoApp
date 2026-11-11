// Pruebas de integración contra una BD Postgres DESCARTABLE (DATABASE_URL_TEST).
// Separadas de las unitarias (vitest.config.ts): `npm run test:integration`.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    setupFiles: ["tests/integration/setup.ts"],
    // Una sola BD compartida: los archivos corren en serie para no pisarse.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
