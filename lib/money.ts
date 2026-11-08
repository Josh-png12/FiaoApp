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

/**
 * Parsea lo que escribe el tendero: "12.500", "12500", "$12.500", "12,500".
 * Devuelve null si no es un monto válido.
 */
export function parseCOP(input: string): Money | null {
  const cleaned = input.trim().replace(/\$/g, "").replace(/\s/g, "");
  if (cleaned === "") return null;
  // En Colombia el punto es separador de miles; la coma sería decimal.
  // Para el MVP tratamos puntos Y comas como separadores de miles
  // (los montos COP no llevan decimales en la práctica).
  const normalized = cleaned.replace(/[.,]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  return money(normalized);
}

/** Serializa para enviar por API / guardar en IndexedDB (string exacto). */
export function moneyToString(value: Decimal): string {
  return value.toFixed(2);
}

/** Atajos de montos frecuentes para los botones rápidos de la UI. */
export const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000] as const;
