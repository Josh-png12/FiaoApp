import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  money,
  sum,
  formatCOP,
  parseCOP,
  parseAmount,
  moneyToString,
  ZERO,
  MAX_AMOUNT,
  SOFT_CONFIRM_AMOUNT,
} from "./money";

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
  const ok = (s: string) => parseCOP(s)?.toFixed(0);

  it("parsea pesos enteros con y sin punto de miles", () => {
    expect(ok("0")).toBe("0");
    expect(ok("500")).toBe("500");
    expect(ok("12500")).toBe("12500");
    expect(ok("12.500")).toBe("12500");
    expect(ok("1.250.000")).toBe("1250000");
    expect(ok("20.000.000")).toBe("20000000");
  });

  it("acepta `$` inicial con espacios y recorta espacios en los extremos", () => {
    expect(ok("$12.500")).toBe("12500");
    expect(ok("$ 12.500")).toBe("12500");
    expect(ok("$   500")).toBe("500");
    expect(ok("  1.000.000  ")).toBe("1000000");
    expect(ok("\t$5000\t")).toBe("5000");
  });

  it("rechaza vacío y solo símbolos", () => {
    expect(parseCOP("")).toBeNull();
    expect(parseCOP("   ")).toBeNull();
    expect(parseCOP("$")).toBeNull();
    expect(parseCOP("$   ")).toBeNull();
  });

  it("rechaza cualquier coma", () => {
    for (const s of ["12,5", "12,50", "1.500,50", "1,500", "12,500", "1,2,3", "12,", ",5"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza separadores de miles mal formados", () => {
    for (const s of ["12.5", "12.50", "1.0000", "1234.567", "12..500", ".500", "12.500.", "1.50.000"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza espacios internos y `$` en otra posición", () => {
    for (const s of ["1 2 3", "12 500", "1$2", "$$5", "5$", "$ $5", "12.500 $", "1\u00a0500"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza saltos de línea", () => {
    for (const s of ["12\n", "\n12", "1\n2", "12\r\n", "$\n5"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza ceros a la izquierda", () => {
    for (const s of ["007", "00", "0.500", "0.000", "$007", "01.000"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza notación científica, letras, signos y negativos", () => {
    for (const s of ["1e5", "1E5", "abc", "12a00", "0x10", "+5", "-5", "-5000", "5-", "(5)", "--5"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("rechaza dígitos no ASCII", () => {
    for (const s of ["１２３", "٣٤", "१२", "12\u0663"]) {
      expect(parseCOP(s), s).toBeNull();
    }
  });

  it("parsea valores enormes sin perder dígitos (el tope lo pone parseAmount)", () => {
    const digits30 = "123456789012345678901234567890";
    expect(parseCOP(digits30)?.toFixed(0)).toBe(digits30);
  });
});

describe("parseAmount()", () => {
  const code = (s: string) => {
    const r = parseAmount(s);
    return r.ok ? "OK" : r.code;
  };

  it("expone los topes provisionales", () => {
    expect(MAX_AMOUNT.toFixed(0)).toBe("20000000");
    expect(SOFT_CONFIRM_AMOUNT.toFixed(0)).toBe("1000000");
    expect(SOFT_CONFIRM_AMOUNT.lt(MAX_AMOUNT)).toBe(true);
  });

  it("acepta montos válidos y devuelve un Decimal exacto", () => {
    const r = parseAmount("12.500");
    expect(r.ok && r.value.toFixed(2)).toBe("12500.00");
    expect(code("12500")).toBe("OK");
    expect(code("1")).toBe("OK");
  });

  it("acepta exactamente MAX_AMOUNT y rechaza MAX_AMOUNT + 1", () => {
    expect(code("20000000")).toBe("OK");
    expect(code("20.000.000")).toBe("OK");
    expect(code("20000001")).toBe("TOO_LARGE");
    expect(code("20.000.001")).toBe("TOO_LARGE");
  });

  it("rechaza 30 dígitos con TOO_LARGE, sin aritmética", () => {
    expect(code("123456789012345678901234567890")).toBe("TOO_LARGE");
    expect(code("9".repeat(500))).toBe("TOO_LARGE");
  });

  it('"0" se parsea pero no es positivo', () => {
    expect(parseCOP("0")?.isZero()).toBe(true);
    expect(code("0")).toBe("NOT_POSITIVE");
    expect(code("$ 0")).toBe("NOT_POSITIVE");
  });

  it("negativos, comas y formatos inválidos son INVALID", () => {
    for (const s of ["-5000", "12,50", "1 000", "007", "0.500", "1e5", "12\n", "abc", "", "$"]) {
      expect(code(s), s).toBe("INVALID");
    }
  });

  it("no lanza con entradas que no son string", () => {
    // @ts-expect-error entrada inválida a propósito (datos externos)
    expect(parseAmount(undefined)).toEqual({ ok: false, code: "INVALID" });
    // @ts-expect-error entrada inválida a propósito (datos externos)
    expect(parseAmount(12500)).toEqual({ ok: false, code: "INVALID" });
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
