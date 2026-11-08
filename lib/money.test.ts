import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { money, sum, formatCOP, parseCOP, moneyToString, ZERO } from "./money";

describe("money()", () => {
  it("crea Decimal desde number, string y Decimal", () => {
    expect(money(12500).toFixed(2)).toBe("12500.00");
    expect(money("12500.50").toFixed(2)).toBe("12500.50");
    expect(money(new Decimal(3)).toFixed(2)).toBe("3.00");
  });

  it("rechaza valores inválidos", () => {
    expect(() => money(NaN)).toThrow();
    expect(() => money(Infinity)).toThrow();
    expect(() => money("abc")).toThrow();
  });

  it("no pierde precisión donde float sí la pierde", () => {
    // 0.1 + 0.2 !== 0.3 en float; con Decimal sí
    expect(money("0.1").plus(money("0.2")).equals(money("0.3"))).toBe(true);
  });
});

describe("sum()", () => {
  it("suma lista de montos", () => {
    expect(sum([1000, 2500, "500"]).toFixed(2)).toBe("4000.00");
  });
  it("lista vacía = 0", () => {
    expect(sum([]).equals(ZERO)).toBe(true);
  });
});

describe("formatCOP()", () => {
  it("formatea con punto de miles y sin decimales", () => {
    expect(formatCOP(12500)).toBe("$12.500");
    expect(formatCOP(1000000)).toBe("$1.000.000");
    expect(formatCOP(500)).toBe("$500");
    expect(formatCOP(0)).toBe("$0");
  });

  it("muestra centavos solo si existen", () => {
    expect(formatCOP("12500.50")).toBe("$12.500,50");
    expect(formatCOP("12500.00")).toBe("$12.500");
  });

  it("negativos", () => {
    expect(formatCOP(-3000)).toBe("-$3.000");
  });
});

describe("parseCOP()", () => {
  it("parsea formatos que escribe el tendero", () => {
    expect(parseCOP("12500")?.toFixed(0)).toBe("12500");
    expect(parseCOP("12.500")?.toFixed(0)).toBe("12500");
    expect(parseCOP("$12.500")?.toFixed(0)).toBe("12500");
    expect(parseCOP(" 1.000.000 ")?.toFixed(0)).toBe("1000000");
  });

  it("devuelve null en entradas inválidas", () => {
    expect(parseCOP("")).toBeNull();
    expect(parseCOP("abc")).toBeNull();
    expect(parseCOP("12a00")).toBeNull();
  });
});

describe("moneyToString()", () => {
  it("serializa con 2 decimales exactos", () => {
    expect(moneyToString(money(12500))).toBe("12500.00");
  });
});

describe("saldo de cliente (regla de dominio)", () => {
  it("saldo = fiados no anulados - abonos no anulados", () => {
    const fiados = [
      { amount: "10000", voidedAt: null },
      { amount: "5000", voidedAt: null },
      { amount: "8000", voidedAt: new Date() }, // anulado: no cuenta
    ];
    const abonos = [
      { amount: "4000", voidedAt: null },
      { amount: "2000", voidedAt: new Date() }, // anulado: no cuenta
    ];
    const saldo = sum(fiados.filter((f) => !f.voidedAt).map((f) => f.amount)).minus(
      sum(abonos.filter((a) => !a.voidedAt).map((a) => a.amount))
    );
    expect(formatCOP(saldo)).toBe("$11.000");
  });
});
