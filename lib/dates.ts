// =====================================================================
// lib/dates.ts — "El día del tendero" se calcula en America/Bogota.
// Regla NO negociable: cierre de caja, ventas de hoy, etc. usan TZ
// Bogotá, nunca UTC. Bogotá es UTC-5 fijo (sin horario de verano).
// Sin dependencias: usa Intl nativo.
// =====================================================================

export const TIMEZONE = "America/Bogota";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha (YYYY-MM-DD) de un instante, vista desde Bogotá. */
export function bogotaDateKey(instant: Date = new Date()): string {
  return dateFmt.format(instant); // en-CA → "2026-07-01"
}

/**
 * Inicio del día del tendero (00:00 Bogotá) como instante UTC.
 * Bogotá = UTC-5 sin DST → 00:00 Bogotá = 05:00 UTC.
 */
export function startOfBogotaDay(instant: Date = new Date()): Date {
  const key = bogotaDateKey(instant);
  return new Date(`${key}T00:00:00-05:00`);
}

/** Fin exclusivo del día del tendero (00:00 del día siguiente, Bogotá). */
export function endOfBogotaDay(instant: Date = new Date()): Date {
  const start = startOfBogotaDay(instant);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/** Rango [desde, hasta) del día del tendero, para queries de "hoy". */
export function bogotaDayRange(instant: Date = new Date()): {
  gte: Date;
  lt: Date;
} {
  return { gte: startOfBogotaDay(instant), lt: endOfBogotaDay(instant) };
}

/** ¿Dos instantes caen en el mismo día del tendero? */
export function isSameBogotaDay(a: Date, b: Date): boolean {
  return bogotaDateKey(a) === bogotaDateKey(b);
}

/** Fecha legible para el tendero: "miércoles 1 de julio". */
export function formatBogotaDate(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(instant);
}

/** Hora legible: "3:45 p. m." */
export function formatBogotaTime(instant: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}
