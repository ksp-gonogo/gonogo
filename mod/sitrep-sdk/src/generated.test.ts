import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_TYPE_UNITS } from "./__generated__/units";

const src = readFileSync(
  fileURLToPath(new URL("./__generated__/contract.ts", import.meta.url)),
  "utf8",
);

describe("generated contract.ts", () => {
  it("is an ES module (export, no `module` wrapper)", () => {
    expect(src).toMatch(/export interface StreamData<T>/);
    expect(src).not.toMatch(/^\s*module /m);
    // no I-prefix on ANY generated interface (AutoI(false) convention)
    expect(src).not.toMatch(/\binterface I[A-Z]/);
  });
  it("has camelCase properties", () => {
    // Names only. Both of these carry a declared unit, so their emitted type is
    // Value<"s">, and pinning `: number` here made this test a hostage to a
    // change that has nothing to do with casing.
    expect(src).toMatch(/\bvalidAt\??:/);
    expect(src).toMatch(/\bdeliveredAt\??:/);
    expect(src).not.toMatch(/\bValidAt\??:/);
  });
  it("keeps all 7 literal-narrowed discriminants", () => {
    expect(src).toMatch(/type:\s*"stream-data"/);
    expect(src).toMatch(/type:\s*"event"/);
    expect(src).toMatch(/type:\s*"command-request"/);
    expect(src).toMatch(/type:\s*"command-response"/);
    expect(src).toMatch(/type:\s*"error"/);
    expect(src).toMatch(/type:\s*"subscribe"/);
    expect(src).toMatch(/type:\s*"unsubscribe"/);
  });
  it("emits all generics", () => {
    expect(src).toMatch(/export interface CommandRequest<TArgs>/);
    expect(src).toMatch(/export interface CommandResponse<TResult>/);
    expect(src).toMatch(/export interface StreamData<T>/);
  });
  it("emits optional properties", () => {
    expect(src).toMatch(/requestId\?:/);
    expect(src).toMatch(/oneWaySeconds\?:/);
  });
  it("emits the wire payload types, not just the envelope", () => {
    expect(src).toMatch(/export interface VesselOrbit\b/);
    expect(src).toMatch(/export interface VesselComms\b/);
    expect(src).toMatch(/export interface CommsConnectivity\b/);
    expect(src).toMatch(/export interface KosProcessorInfo\b/);
    expect(src).toMatch(/export interface Vec3\b/);
    // shared value shapes carry data only: no static factory methods leaked
    expect(src).toMatch(/export interface CommandResult\b/);
    expect(src).not.toMatch(/Ok\s*\(/);
    expect(src).not.toMatch(/Fail\s*\(/);
    // generic result renamed to avoid a TS2428 arity clash with its base
    expect(src).toMatch(
      /export interface CommandResultOf<T> extends CommandResult\b/,
    );
  });
  it("emits the wire enums", () => {
    expect(src).toMatch(/export enum CommandErrorCode \{/);
    expect(src).toMatch(/export enum VesselType \{/);
    expect(src).toMatch(/export enum Situation \{/);
    expect(src).toMatch(/export enum ControlState \{/);
  });
});

// ── Declared units as TYPES ──────────────────────────────────────────────────
//
// Every [SitrepUnit]-annotated property that names a QUANTITY is emitted as
// `Value<"<token>">` rather than a bare `number`, so the unit travels in the
// type system instead of only in the field->unit map beside it. That map is
// still generated, and it is what makes the check below exhaustive: it lists
// every annotation, so the assertion covers all of them rather than a handful
// someone remembered to write down.
//
// Three deliberate exemptions, each pinned separately below: the non-quantity
// tokens (a vessel name has no magnitude), Vec3-typed properties (a vector of
// three same-unit components is a shape this design has not named yet), and
// enum-typed properties.

/** Tokens that declare a property is not a scalable quantity. */
const NON_QUANTITY = new Set(["text", "flag", "enum", "id", "n/a"]);

/** `{ InterfaceName: { fieldName: tsType } }`, parsed out of the emitted source. */
function parseInterfaces(
  source: string,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const blocks = source.matchAll(
    /^export interface (\w+)(?:<[^>]*>)?(?: extends [^\n{]+)?\s*\n\{\n([\s\S]*?)^\}/gm,
  );
  for (const block of blocks) {
    const fields: Record<string, string> = {};
    for (const line of block[2].split("\n")) {
      const field = line.match(/^\s*(\w+)\??:\s*(.+);\s*$/);
      if (field) {
        fields[field[1]] = field[2];
      }
    }
    out[block[1]] = fields;
  }
  return out;
}

describe("generated contract.ts unit types", () => {
  const interfaces = parseInterfaces(src);

  it("imports Value once, at the top", () => {
    // rtcli emits single-quoted module specifiers; match either so a formatter
    // pass over the generated file would not break this.
    expect(
      src.match(/^import \{ Value \} from ['"][^'"]*value['"];?$/gm),
    ).toHaveLength(1);
  });

  it("types every annotated quantity as Value<token>", () => {
    const wrong: string[] = [];
    for (const [typeName, fields] of Object.entries(GENERATED_TYPE_UNITS)) {
      const emitted = interfaces[typeName];
      if (!emitted) {
        // A [SitrepUnit]-annotated type that is not in the rtcli export list.
        // The unit map covers the whole assembly; the contract exports a
        // curated subset. Nothing to check.
        continue;
      }
      for (const [field, token] of Object.entries(fields)) {
        // A Vec3 field's unit propagates onto dotted leaf keys (position.x).
        // The parent stays a bare Vec3, so the leaves are not fields of their
        // own and there is nothing to assert against.
        if (field.includes(".")) {
          continue;
        }
        const tsType = emitted[field];
        if (tsType === undefined || tsType === "Vec3") {
          continue;
        }
        const wrapped =
          tsType === `Value<"${token}">` || tsType === `Value<"${token}">[]`;
        const bare = !tsType.includes("Value<");
        const ok = NON_QUANTITY.has(token) ? bare : wrapped;
        if (!ok) {
          wrong.push(`${typeName}.${field}: ${token} -> ${tsType}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the unit inside the array for a sequence of readings", () => {
    // The unit belongs to each ELEMENT: a terrain profile is a list of
    // distances, not one distance.
    expect(interfaces.VesselLanding?.terrainPatch).toBe('Value<"m">[]');
  });

  it("keeps optionality alongside the wrapped type", () => {
    expect(src).toMatch(/heatShieldFlux\?: Value<"kW">;/);
  });

  it("leaves non-quantities bare", () => {
    expect(interfaces.ActionGroupState).toMatchObject({
      index: "number", // "id": arithmetic on it is meaningless
      name: "string", // "text"
      state: "boolean", // "flag"
    });
  });

  it("leaves Vec3-typed properties bare, pending a vector shape", () => {
    // Their unit is still declared and still reaches a consumer through the
    // field->unit map's propagated x/y/z leaves. What does not exist yet is a
    // TS shape for "three components sharing one unit".
    expect(interfaces.DockAlignment).toMatchObject({
      relativePosition: "Vec3",
      relativeVelocity: "Vec3",
      distance: 'Value<"m">',
    });
  });

  it("leaves unannotated numbers bare", () => {
    // Computed rather than named, because the contract's unit coverage is very
    // nearly total: at the time of writing exactly one numeric property has no
    // [SitrepUnit] on it, and hard-coding that field would make this test fail
    // the day someone closes the gap. An empty set is a pass, not a skip: it
    // would mean there is no unannotated number left to get wrong.
    const bare: string[] = [];
    for (const [typeName, fields] of Object.entries(interfaces)) {
      const declared = GENERATED_TYPE_UNITS[typeName] ?? {};
      for (const [field, tsType] of Object.entries(fields)) {
        if (!(field in declared) && tsType.includes("Value<")) {
          bare.push(`${typeName}.${field}: ${tsType}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });
});
