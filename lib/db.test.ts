import { describe, it, expect } from "vitest";
import { withStore } from "./db";

describe("withStore() — multi-tenancy", () => {
  it("inyecta storeId en where vacío", () => {
    expect(withStore("store_1")).toEqual({ storeId: "store_1" });
    expect(withStore("store_1", undefined)).toEqual({ storeId: "store_1" });
  });

  it("mezcla storeId con filtros existentes", () => {
    expect(withStore("store_1", { isActive: true })).toEqual({
      isActive: true,
      storeId: "store_1",
    });
  });

  it("sobrescribe cualquier storeId que venga en el where (anti-fuga entre tiendas)", () => {
    expect(withStore("store_1", { storeId: "store_OTRA" })).toEqual({
      storeId: "store_1",
    });
  });

  it("lanza si falta storeId", () => {
    expect(() => withStore("")).toThrow();
  });
});
