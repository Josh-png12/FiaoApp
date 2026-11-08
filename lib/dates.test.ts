import { describe, it, expect } from "vitest";
import {
  bogotaDateKey,
  startOfBogotaDay,
  endOfBogotaDay,
  bogotaDayRange,
  isSameBogotaDay,
} from "./dates";

describe("día del tendero (TZ America/Bogota, UTC-5)", () => {
  it("un instante a las 11pm Bogotá sigue siendo 'hoy' aunque en UTC ya sea mañana", () => {
    // 2026-07-01 23:30 Bogotá = 2026-07-02 04:30 UTC
    const instant = new Date("2026-07-02T04:30:00Z");
    expect(bogotaDateKey(instant)).toBe("2026-07-01");
  });

  it("medianoche Bogotá corta el día correctamente", () => {
    const justBefore = new Date("2026-07-02T04:59:59Z"); // 23:59:59 del 1 jul Bogotá
    const justAfter = new Date("2026-07-02T05:00:00Z"); // 00:00:00 del 2 jul Bogotá
    expect(bogotaDateKey(justBefore)).toBe("2026-07-01");
    expect(bogotaDateKey(justAfter)).toBe("2026-07-02");
    expect(isSameBogotaDay(justBefore, justAfter)).toBe(false);
  });

  it("startOfBogotaDay = 05:00 UTC del mismo día tendero", () => {
    const instant = new Date("2026-07-01T18:00:00Z"); // 1pm Bogotá
    expect(startOfBogotaDay(instant).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(endOfBogotaDay(instant).toISOString()).toBe("2026-07-02T05:00:00.000Z");
  });

  it("bogotaDayRange cubre exactamente 24h [gte, lt)", () => {
    const { gte, lt } = bogotaDayRange(new Date("2026-07-01T18:00:00Z"));
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1000);
    // el instante consultado cae dentro del rango
    const instant = new Date("2026-07-01T18:00:00Z");
    expect(instant >= gte && instant < lt).toBe(true);
  });

  it("ventas de las 8pm Bogotá quedan en el día correcto (bug clásico de UTC)", () => {
    // 8pm Bogotá del 1 jul = 01:00 UTC del 2 jul.
    // Con UTC ingenuo esta venta caería en el día 2 — error.
    const venta = new Date("2026-07-02T01:00:00Z");
    const { gte, lt } = bogotaDayRange(new Date("2026-07-01T15:00:00Z")); // consulta hecha el 1 jul 10am
    expect(venta >= gte && venta < lt).toBe(true);
  });
});
