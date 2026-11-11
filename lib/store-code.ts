// =====================================================================
// lib/store-code.ts — Código corto de tienda (R2, docs/R2-AUTENTICACION.md §2.2).
// 6 caracteres de un alfabeto sin símbolos ambiguos (sin 0 O 1 I L U), pensado para dictarse
// por teléfono o leerse en un papel. NO es un secreto: identifica la tienda; la seguridad está
// en usuario + PIN + límite de intentos.
// Debe coincidir con el CHECK "Store_code_format_chk" de la migración r2.
// =====================================================================
import { randomInt } from "node:crypto";

export const STORE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const STORE_CODE_LENGTH = 6;
export const STORE_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/** Código aleatorio criptográficamente uniforme (crypto.randomInt, sin sesgo de módulo). */
export function generateStoreCode(): string {
  let code = "";
  for (let i = 0; i < STORE_CODE_LENGTH; i++) {
    code += STORE_CODE_ALPHABET[randomInt(STORE_CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidStoreCode(code: string): boolean {
  return STORE_CODE_PATTERN.test(code);
}
