// La guarda que impide correr las pruebas destructivas contra desarrollo.
// Pura: usa URLs falsas, no toca ninguna base de datos.
import { describe, expect, it } from "vitest";
import { assertSafeTestDatabase, dbHost } from "./guard";

const DEV = "postgresql://u:p@ep-dev-aaa-pooler.region.aws.neon.tech/neondb?sslmode=require";
const TEST = "postgresql://u:p@ep-test-bbb.region.aws.neon.tech/neondb?sslmode=require";

describe("assertSafeTestDatabase", () => {
  it("acepta una BD de pruebas distinta de la de desarrollo", () => {
    expect(assertSafeTestDatabase(TEST, DEV)).toBe(TEST);
  });

  it("acepta si no hay URL de desarrollo definida", () => {
    expect(assertSafeTestDatabase(TEST, undefined)).toBe(TEST);
  });

  it("rechaza la misma URL que desarrollo", () => {
    expect(() => assertSafeTestDatabase(DEV, DEV)).toThrow(/mismo servidor/);
  });

  it("rechaza el mismo servidor aunque cambie -pooler (conexión directa vs pooler)", () => {
    const direct = DEV.replace("-pooler", "");
    expect(() => assertSafeTestDatabase(direct, DEV)).toThrow(/mismo servidor/);
    expect(() => assertSafeTestDatabase(DEV, direct)).toThrow(/mismo servidor/);
  });

  it("rechaza si falta DATABASE_URL_TEST", () => {
    expect(() => assertSafeTestDatabase(undefined, DEV)).toThrow(/Falta DATABASE_URL_TEST/);
    expect(() => assertSafeTestDatabase("", DEV)).toThrow(/Falta DATABASE_URL_TEST/);
  });

  it("rechaza una URL inválida", () => {
    expect(() => assertSafeTestDatabase("esto no es una url", DEV)).toThrow(/no es una URL válida/);
  });

  it("el mensaje de error no incluye credenciales ni la URL", () => {
    try {
      assertSafeTestDatabase(DEV, DEV);
    } catch (e) {
      expect((e as Error).message).not.toContain("u:p");
      expect((e as Error).message).not.toContain("ep-dev-aaa");
    }
  });

  it("dbHost normaliza el host", () => {
    expect(dbHost(DEV)).toBe("ep-dev-aaa.region.aws.neon.tech");
  });
});
