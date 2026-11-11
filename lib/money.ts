// =====================================================================
// lib/money.ts — Dinero en FiaoApp
// Regla NO negociable: nunca Float para montos.
// - En DB: Decimal(12,2) de Prisma.
// - En código: Decimal de decimal.js para aritmética.
// - Formato UI: $12.500 (punto de miles, sin decimales, español colombiano).
// =====================================================================
import Decimal from "decimal.js";

export type Money = Decimal;

/** Crea un Decimal desde string, number o Decimal. Lanza si es inválido. */
export function money(value: string | number | Decimal): Money {
  const d = new Decimal(value);
  if (d.isNaN() || !d.isFinite()) {
    throw new Error(`Monto inválido: ${value}`);
  }
  return d;
}

export const ZERO: Money = new Decimal(0);

/** Suma una lista de montos. */
export function sum(values: (string | number | Decimal)[]): Money {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), ZERO);
}

/**
 * Formatea a pesos colombianos: $12.500 (punto de miles, sin decimales).
 * Si tiene centavos (raro en COP), los muestra con coma: $12.500,50
 */
export function formatCOP(value: string | number | Decimal): string {
  const d = money(value);
  const negative = d.isNegative();
  const abs = d.abs();

  const intPart = abs.floor();
  const fraction = abs.minus(intPart);

  // Punto de miles manual (evita depender del locale del dispositivo)
  const intStr = intPart.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  let result = `$${intStr}`;
  if (!fraction.isZero()) {
    const cents = fraction.times(100).round().toFixed(0).padStart(2, "0");
    result += `,${cents}`;
  }
  return negative ? `-${result}` : result;
}

// ---------------------------------------------------------------------
// CONTRATO DE MONTOS DE ENTRADA
// FiaoApp maneja SOLO PESOS ENTEROS (escala 0). La BD sigue en Decimal(12,2),
// pero la regla "sin centavos" se aplica aquí, en la validación.
//
// - La UI formatea y parsea lo que escribe la persona (formatCOP / parseCOP).
// - La API recibe un string canónico de SOLO DÍGITOS ("12500") y lo revalida
//   SIEMPRE con parseAmount(). Ningún endpoint reimplementa positividad ni tope.
// - El tope se valida ANTES de cualquier suma o escritura.
// ---------------------------------------------------------------------

// Valores provisionales, pendientes de confirmar con Joshua.
/** Monto máximo permitido por movimiento (fiado, abono, venta). */
export const MAX_AMOUNT: Money = new Decimal(20_000_000);
/** A partir de este monto la UI debe pedir una confirmación extra. */
export const SOFT_CONFIRM_AMOUNT: Money = new Decimal(1_000_000);

// "0" | entero sin ceros a la izquierda | entero con puntos de miles
// (primer grupo de 1–3 dígitos, luego grupos exactos de 3). \d es solo ASCII.
const COP_PATTERN = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/;

/**
 * Parsea lo que escribe una persona: pesos enteros, con punto de miles
 * opcional y un `$` inicial opcional (seguido de espacios).
 *
 *   "12500", "12.500", "1.250.000", "$12.500", "$ 12.500", "0" → válidos
 *
 * Devuelve null en todo lo demás: comas, espacios internos, `$` en otra
 * posición, saltos de línea, ceros a la izquierda ("007", "0.500"),
 * "12.5", "1.0000", notación científica, dígitos no ASCII y signos.
 * Solo se recortan espacios normales y tabulaciones en los extremos;
 * un salto de línea o NBSP hace que la entrada sea inválida.
 * Es preferible rechazar a guardar un monto equivocado.
 * NO valida positividad ni tope: para eso usa parseAmount().
 */
export function parseCOP(input: string): Money | null {
  let s = input.replace(/^[ \t]+|[ \t]+$/g, "");
  if (s.startsWith("$")) s = s.slice(1).replace(/^ +/, "");
  if (!COP_PATTERN.test(s)) return null;
  return money(s.replace(/\./g, ""));
}

export type ParseAmountResult =
  | { ok: true; value: Money }
  | { ok: false; code: "INVALID" | "NOT_POSITIVE" | "TOO_LARGE" };

/**
 * Validación única de montos (formato + positividad + tope).
 * Úsala en cada endpoint; no reimplementes estas reglas.
 */
export function parseAmount(input: string): ParseAmountResult {
  if (typeof input !== "string") return { ok: false, code: "INVALID" };
  const value = parseCOP(input);
  if (value === null) return { ok: false, code: "INVALID" };
  if (!value.gt(0)) return { ok: false, code: "NOT_POSITIVE" };
  // Comparación exacta (no aritmética): segura aun con muchos dígitos.
  if (value.gt(MAX_AMOUNT)) return { ok: false, code: "TOO_LARGE" };
  return { ok: true, value };
}

/** Serializa para enviar por API / guardar en IndexedDB (string exacto). */
export function moneyToString(value: Decimal): string {
  return value.toFixed(2);
}

/** Atajos de montos frecuentes para los botones rápidos de la UI. */
export const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000] as const;
