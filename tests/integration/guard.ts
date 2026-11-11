// Guarda de seguridad de las pruebas de integración (pura, testeable sin BD).
// Las pruebas hacen TRUNCATE: jamás deben correr contra la BD de desarrollo.

/** Host sin el sufijo "-pooler": la misma BD de Neon se alcanza por ambos. */
export function dbHost(url: string): string {
  try {
    return new URL(url).hostname.replace("-pooler", "");
  } catch {
    return "";
  }
}

/** Lanza si falta la URL de pruebas o si apunta al mismo servidor que la de desarrollo. */
export function assertSafeTestDatabase(
  testUrl: string | undefined,
  devUrl: string | undefined
): string {
  if (!testUrl) {
    throw new Error(
      "Falta DATABASE_URL_TEST. Define una BD Postgres descartable en .env.test (no versionado)."
    );
  }
  const testHost = dbHost(testUrl);
  if (!testHost) {
    throw new Error("DATABASE_URL_TEST no es una URL válida.");
  }
  if (devUrl && dbHost(devUrl) === testHost) {
    throw new Error(
      "DATABASE_URL_TEST apunta al mismo servidor que DATABASE_URL (desarrollo). " +
        "Las pruebas de integración borran datos: usa una BD distinta y descartable."
    );
  }
  return testUrl;
}
