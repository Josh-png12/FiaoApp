// Setup de las pruebas de integración.
// 1) Lee DATABASE_URL_TEST (entorno o .env.test, que NO se versiona).
// 2) SE NIEGA a correr si apunta al mismo servidor que DATABASE_URL del .env (desarrollo).
// 3) Fuerza process.env.DATABASE_URL = DATABASE_URL_TEST antes de que Prisma se instancie,
//    así lib/prisma.ts y storeDb hablan con la BD de pruebas.
import fs from "node:fs";
import path from "node:path";
import { assertSafeTestDatabase } from "./guard";

function readEnvFile(name: string): Record<string, string> {
  const file = path.resolve(process.cwd(), name);
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

const testUrl = assertSafeTestDatabase(
  process.env.DATABASE_URL_TEST ?? readEnvFile(".env.test").DATABASE_URL_TEST,
  readEnvFile(".env").DATABASE_URL
);

process.env.DATABASE_URL = testUrl;
