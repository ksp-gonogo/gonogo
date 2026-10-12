import { reckonableValuesOf } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { isReckonedField } from "./reckonedField";

describe("isReckonedField", () => {
  it("is false for an address with no topic or path", () => {
    expect(isReckonedField("", "altitudeAsl")).toBe(false);
    expect(isReckonedField("vessel.flight", "")).toBe(false);
  });

  it("agrees with the contract's declared models for vessel.flight", () => {
    const declared = new Set(
      reckonableValuesOf("vessel.flight").map((row) => row.field),
    );
    expect(declared.size).toBeGreaterThan(0);
    for (const field of declared) {
      expect(isReckonedField("vessel.flight", field)).toBe(true);
    }
  });

  it("is false for a field no model moves", () => {
    expect(isReckonedField("vessel.flight", "noSuchField")).toBe(false);
  });
});
