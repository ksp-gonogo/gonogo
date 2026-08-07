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
// Three shapes carry a unit: a scalar becomes `Value<U>`, a sequence of
// same-unit readings takes it inside the array, and a Vec3 becomes `Vec3Of<U>`
// with the unit on its x/y/z leaves. The one exemption is the non-quantity
// tokens, pinned separately below: a vessel name has no magnitude to carry.

/** Tokens that declare a property is not a scalable quantity. */
const NON_QUANTITY = new Set(["text", "flag", "enum", "id", "n/a"]);

/**
 * Types whose declared quantities stay BARE, because they are transport rather
 * than telemetry.
 *
 * `Meta` rides on every stream-data message and its timestamps are used by ten
 * transport and timeline files for ordering, staleness and heartbeats. Not one
 * readout shows them. Wrapping them put a `Value` in the way of arithmetic in
 * code that is plumbing, and allocated two objects per message on the hottest
 * path in the app for a quantity nobody looks at.
 *
 * This exemption exists because the exhaustive check below is right by default
 * and was wrong here: it saw `Meta.validAt` untyped, that looked like the bug
 * it is designed to catch, and closing it was backwards. The DECLARATION stays
 * on the C# property, because the field really is in seconds; what stops is the
 * declaration becoming a type.
 */
function isWireWrite(typeName: string): boolean {
  // A command ARGS type is something the client SENDS. The wrap is inbound
  // only, so a Value here would reach JSON.stringify and serialise as
  // {"magnitude":80,"unit":"count"}, which the mod's deserialiser rejects.
  // Same rule as TRANSPORT_ONLY, from the other direction: the unit system
  // describes what the client RECEIVES.
  return typeName.endsWith("Args");
}

const TRANSPORT_ONLY = new Set([
  "Meta",
  "EventMsg",
  "ErrorMsg",
  "Subscribe",
  "Unsubscribe",
  "StreamData",
  "CommandRequest",
  "CommandResponse",
  "CommandResultOf",
]);

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

  it("imports the value types once, at the top", () => {
    // rtcli emits single-quoted module specifiers; match either so a formatter
    // pass over the generated file would not break this.
    expect(
      src.match(/^import \{ Value, Vec3Of \} from ['"][^'"]*value['"];?$/gm),
    ).toHaveLength(1);
  });

  it("types every annotated quantity as Value<token>", () => {
    const wrong: string[] = [];
    for (const [typeName, fields] of Object.entries(GENERATED_TYPE_UNITS)) {
      if (TRANSPORT_ONLY.has(typeName) || isWireWrite(typeName)) {
        continue;
      }
      const emitted = interfaces[typeName];
      if (!emitted) {
        // A [SitrepUnit]-annotated type that is not in the rtcli export list.
        // The unit map covers the whole assembly; the contract exports a
        // curated subset. Nothing to check.
        continue;
      }
      for (const [field, token] of Object.entries(fields)) {
        // A Vec3 field's unit propagates onto dotted leaf keys (position.x) in
        // the map. In the TYPE it rides on the parent as Vec3Of<U>, so assert
        // against that and skip the leaves.
        if (field.includes(".")) {
          const parent = field.slice(0, field.indexOf("."));
          const parentType = emitted[parent];
          if (parentType !== undefined && parentType !== `Vec3Of<"${token}">`) {
            wrong.push(`${typeName}.${parent}: ${token} -> ${parentType}`);
          }
          continue;
        }
        const tsType = emitted[field];
        if (tsType === undefined) {
          continue;
        }
        const wrapped =
          tsType === `Value<"${token}">` ||
          // A sequence of same-unit readings: the unit is on each ELEMENT.
          tsType === `Value<"${token}">[]` ||
          // A name-keyed map of same-unit readings: the unit is on each VALUE,
          // and the key is just a name.
          tsType === `{ [key: string]: Value<"${token}"> }` ||
          tsType === `Vec3Of<"${token}">`;
        const bare = !tsType.includes("Value<") && !tsType.includes("Vec3Of<");
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

  it("keeps the unit inside the map for a name-keyed set of readings", () => {
    // Same rule as the sequence above: the unit belongs to each VALUE, and the
    // key is a resource NAME, not a property, so nothing camel-cases it.
    expect(interfaces.KerbalismLifeSupport?.rates).toBe(
      '{ [key: string]: Value<"units/s"> }',
    );
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

  it("carries a Vec3's per-use-site unit down to its leaves", () => {
    // One canonical Vec3 shape is reused at sites carrying three different
    // units, so the unit cannot sit on the type: it is declared on the FIELD,
    // and Vec3Of is what gets it to x/y/z. A position and a velocity are not
    // interchangeable once Value has teeth.
    expect(interfaces.DockAlignment).toMatchObject({
      relativePosition: 'Vec3Of<"m">',
      relativeVelocity: 'Vec3Of<"m/s">',
      distance: 'Value<"m">',
    });
    // Vec3 itself stays unitless. Its own x/y/z are annotated n/a precisely
    // because no single unit is true at every use site.
    expect(interfaces.Vec3).toMatchObject({
      x: "number",
      y: "number",
      z: "number",
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
        // A Vec3 field is declared under its dotted leaves rather than under
        // its own name, so it counts as declared when any leaf names it.
        const isDeclared =
          field in declared ||
          Object.keys(declared).some((key) => key.startsWith(`${field}.`));
        if (TRANSPORT_ONLY.has(typeName) || isWireWrite(typeName)) {
          continue;
        }
        if (
          !isDeclared &&
          (tsType.includes("Value<") || tsType.includes("Vec3Of<"))
        ) {
          bare.push(`${typeName}.${field}: ${tsType}`);
        }
      }
    }
    expect(bare).toEqual([]);
  });
});
