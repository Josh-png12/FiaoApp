import { describe, expect, it } from "vitest";
import {
  STORE_CODE_ALPHABET,
  STORE_CODE_LENGTH,
  generateStoreCode,
  isValidStoreCode,
} from "./store-code";

describe("alfabeto del código de tienda", () => {
  it("tiene 30 símbolos distintos y ninguno ambiguo (0 O 1 I L U)", () => {
    expect(STORE_CODE_ALPHABET).toHaveLength(30);
    expect(new Set(STORE_CODE_ALPHABET).size).toBe(30);
    for (const c of "01OILU") expect(STORE_CODE_ALPHABET).not.toContain(c);
  });
});

describe("generateStoreCode()", () => {
  it("genera 6 caracteres del alfabeto", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateStoreCode();
      expect(code).toHaveLength(STORE_CODE_LENGTH);
      expect(isValidStoreCode(code)).toBe(true);
    }
  });

  it("no repite en una muestra grande (espacio de 30^6 ≈ 729 millones)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateStoreCode());
    expect(seen.size).toBe(5000);
  });

  it("usa todo el alfabeto (no queda ningún símbolo sin salir)", () => {
    const used = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const c of generateStoreCode()) used.add(c);
    expect(used.size).toBe(30);
  });
});

describe("isValidStoreCode()", () => {
  it.each(["K7M4QX", "222222", "ZZZZZZ"])("acepta %s", (c) => expect(isValidStoreCode(c)).toBe(true));

  it.each([
    ["", "vacío"],
    ["K7M4Q", "5 caracteres"],
    ["K7M4QXX", "7 caracteres"],
    ["k7m4qx", "minúsculas"],
    ["K7M-4Q", "guion"],
    ["K7M4Q0", "contiene 0"],
    ["K7M4QO", "contiene O"],
    ["K7M4Q1", "contiene 1"],
    ["K7M4QI", "contiene I"],
    ["K7M4QL", "contiene L"],
    ["K7M4QU", "contiene U"],
    [" K7M4QX", "espacio"],
  ])("rechaza %j (%s)", (c) => expect(isValidStoreCode(c)).toBe(false));
});
