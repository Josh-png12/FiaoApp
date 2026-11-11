import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Regla 5 de CLAUDE.md (multi-tenant): el cliente Prisma crudo solo se importa
  // desde lib/ (donde vive storeDb). Todo lo demás usa storeDb(session.storeId).
  // Excepciones, a propósito:
  //  - app/api/auth/**: TEMPORAL. login/register consultan User/Store antes de que
  //    exista una sesión con storeId. Se retira cuando el Prompt 3 (R2) mueva esas
  //    consultas a lib/.
  //  - tests/**: las pruebas de integración necesitan el cliente crudo para intentar
  //    escrituras cruzadas entre tiendas y comprobar que la BD las rechaza.
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    ignores: ["lib/**", "app/api/auth/**", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "No importes el cliente Prisma crudo: usa storeDb(session.storeId) de @/lib/db (multi-tenant).",
            },
          ],
          patterns: [
            {
              group: ["**/lib/prisma", "**/lib/prisma.*"],
              message:
                "No importes el cliente Prisma crudo: usa storeDb(session.storeId) de @/lib/db (multi-tenant).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
