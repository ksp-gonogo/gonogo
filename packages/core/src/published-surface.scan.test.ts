// @vitest-environment node
import { describe, expect, it } from "vitest";
import { diffShape, keyOf, shapeOfSource } from "./published-surface.scan";

const BASE = [
  "export interface Props {",
  "  a: string;",
  "  b?: number;",
  "  c(x: number): void;",
  "}",
  "export function f(x: number): string { return String(x); }",
  "export const k = 1 as const;",
  'export type U = "a" | "b";',
  "export class C {",
  "  m(): void {}",
  "  private p = 1;",
  "}",
  "export enum E { A = 1 }",
].join("\n");

const shape = (source: string, extra: Record<string, string> = {}) =>
  shapeOfSource({ "plant.ts": source, ...extra }, "plant.ts");

const frozen = shape(BASE);

describe("the published shape of a module", () => {
  it("records every export, and every own member of an interface or class", () => {
    const keys = frozen.map(keyOf);
    for (const key of [
      "plant . Props",
      "plant . Props#a",
      "plant . Props#b?",
      "plant . Props#c",
      "plant . f",
      "plant . k",
      "plant . U",
      "plant . C",
      "plant . C#m",
      "plant . E",
      "plant . E#A",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("does not record a private member", () => {
    expect(frozen.some((line) => line.includes("#p "))).toBe(false);
  });

  it("is not moved by a doc pass or a reflow", () => {
    const edited = BASE.replace(
      "  a: string;",
      "  /** Documented now. */\n  // and a note\n  a:    string ;",
    ).replace("export const k", "/** The constant. */\nexport const k");
    expect(shape(edited)).toEqual(frozen);
  });

  it("reads a removed export as a break", () => {
    const { breaks, additions } = diffShape(
      frozen,
      shape(BASE.replace(/export function f.*\n/, "")),
    );
    expect(breaks).toEqual(["plant . f"]);
    expect(additions).toEqual([]);
  });

  it("reads a retyped member as a break", () => {
    const { breaks } = diffShape(
      frozen,
      shape(BASE.replace("a: string;", "a: number;")),
    );
    expect(breaks).toEqual(["plant . Props#a"]);
  });

  it("reads an optional member made required as a break", () => {
    const { breaks } = diffShape(
      frozen,
      shape(BASE.replace("b?: number;", "b: number;")),
    );
    expect(breaks).toContain("plant . Props#b?");
  });

  it("reads a new required member on an existing interface as a break", () => {
    const { breaks, additions } = diffShape(
      frozen,
      shape(BASE.replace("a: string;", "a: string;\n  d: string;")),
    );
    expect(breaks).toEqual(["plant . Props#d"]);
    expect(additions).toEqual([]);
  });

  it("reads a new optional member as an addition and not a break", () => {
    const { breaks, additions } = diffShape(
      frozen,
      shape(BASE.replace("a: string;", "a: string;\n  e?: string;")),
    );
    expect(breaks).toEqual([]);
    expect(additions).toEqual(["plant . Props#e?"]);
  });

  it("reads a new export as an addition, and a new interface's required members with it", () => {
    const { breaks, additions } = diffShape(
      frozen,
      shape(`${BASE}\nexport interface Fresh { need: string }`),
    );
    expect(breaks).toEqual([]);
    expect(additions).toEqual(["plant . Fresh", "plant . Fresh#need"]);
  });

  it("leaves a generated declaration out by its path", () => {
    const lines = shape(
      `${BASE}\nexport { generated } from "./__generated__/g";`,
      { "__generated__/g.ts": "export const generated = 1;" },
    );
    expect(lines).toEqual(frozen);
  });

  it("escapes a non-ASCII literal, so no dash lands in the ledger", () => {
    const lines = shape(`${BASE}\nexport const DASH = "\u2013";`);
    expect(lines).toContain('plant . DASH :: "\\u{2013}"');
  });

  it("records a third-party pass-through by name only", () => {
    const lines = shape(`${BASE}\nexport { passedOn } from "lib";`, {
      "node_modules/lib/index.d.ts": "export declare const passedOn: number;",
    });
    expect(lines).toContain("plant . passedOn :: reexport lib");
  });
});

describe("a type reachable from the surface but not exported", () => {
  const WITH_HIDDEN = [
    "interface Hidden { x: string; y?: number }",
    "export function g(h: Hidden): void {}",
    "export interface Shown { z: string }",
    "export function s(z: Shown): void {}",
  ].join("\n");

  it("is recorded under a tilde key, because an author still passes one", () => {
    const keys = shape(WITH_HIDDEN).map(keyOf);
    expect(keys).toContain("plant . ~Hidden");
    expect(keys).toContain("plant . ~Hidden#x");
  });

  it("is not recorded twice when it is also exported", () => {
    const keys = shape(WITH_HIDDEN).map(keyOf);
    expect(keys.filter((key) => key.includes("Shown#z"))).toEqual([
      "plant . Shown#z",
    ]);
  });

  it("reads a retyped member of it as a break", () => {
    const { breaks } = diffShape(
      shape(WITH_HIDDEN),
      shape(WITH_HIDDEN.replace("x: string", "x: number")),
    );
    expect(breaks).toEqual(["plant . ~Hidden#x"]);
  });

  it("follows a reference through another unexported type", () => {
    const keys = shape(
      [
        "interface Inner { deep: string }",
        "interface Outer { inner: Inner }",
        "export function h(o: Outer): void {}",
      ].join("\n"),
    ).map(keyOf);
    expect(keys).toContain("plant . ~Inner#deep");
  });

  it("does not read a function body or an initializer for references", () => {
    const keys = shape(
      [
        "interface Local { q: string }",
        "export function k(): void { const l = {} as Local; void l; }",
      ].join("\n"),
    ).map(keyOf);
    expect(keys.some((key) => key.includes("~Local"))).toBe(false);
  });
});
