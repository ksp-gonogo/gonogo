import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_EXTENSIONS_FIELD } from "./extensions";
import type { TopicId } from "./topics";
import { isValue, type Value } from "./unit-system";
import { registerProviderExtensionShape, registerTypeUnits } from "./units";
import { wrapTopicPayload } from "./wrap-units";

// src -> sitrep-sdk -> mod
const MOD_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const asValue = (v: unknown) => v as Value;

// A SYNTHETIC provider and payload, registered through the SDK's own public
// entry points.
//
// The mechanism belongs to core, so its test belongs here, and it has to be
// testable without naming any mod: a core file reaching for a real provider's
// namespace would be exactly the boundary violation the bag exists to make
// unnecessary. Everything below is invented, and the real provider's end-to-end
// proof (server write -> golden fixture -> typed narrow -> wrapped Value) lives
// in that Uplink's own package, where it belongs.
const OWNER = "synthetic.electedPayload" as TopicId;
const PROVIDER = "syntheticprovider";
const EXT_TYPE = "SyntheticProviderExt";

registerTypeUnits(EXT_TYPE, { burnTimeRemaining: "s", cycles: "count" });
registerProviderExtensionShape(OWNER, PROVIDER, EXT_TYPE);

describe("provider extension bag", () => {
  it("names the same wire field the C# contract reserves", () => {
    const src = readFileSync(
      join(MOD_ROOT, "Sitrep.Contract", "ProviderExtensions.cs"),
      "utf8",
    );
    const m = src.match(/const\s+string\s+WireField\s*=\s*"([^"]+)"/);
    expect(m?.[1]).toBe(PROVIDER_EXTENSIONS_FIELD);
  });

  it("hydrates a registered namespace's quantities into Values", () => {
    const wrapped = wrapTopicPayload(OWNER, {
      [PROVIDER_EXTENSIONS_FIELD]: {
        [PROVIDER]: { burnTimeRemaining: 42.5, cycles: 3 },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    const ext = wrapped[PROVIDER_EXTENSIONS_FIELD][PROVIDER];
    // A bare number fails these, which is what makes the walk non-vacuous.
    expect(isValue(ext.burnTimeRemaining)).toBe(true);
    expect(asValue(ext.burnTimeRemaining).unit).toBe("s");
    expect(asValue(ext.burnTimeRemaining).magnitude).toBe(42.5);
    expect(asValue(ext.cycles).unit).toBe("count");
  });

  it("leaves an UNREGISTERED provider's namespace exactly as it arrived", () => {
    // The core layer cannot type a namespace nobody registered, and must not
    // guess: the values pass through untouched rather than being wrapped with
    // some other provider's units.
    const wrapped = wrapTopicPayload(OWNER, {
      [PROVIDER_EXTENSIONS_FIELD]: {
        somebodyelse: { burnTimeRemaining: 42.5 },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(
      wrapped[PROVIDER_EXTENSIONS_FIELD].somebodyelse.burnTimeRemaining,
    ).toBe(42.5);
  });

  it("is a no-op on a payload with no bag, and on a bag with no matching key", () => {
    expect(wrapTopicPayload(OWNER, { altitude: 12 })).toEqual({ altitude: 12 });
    expect(
      wrapTopicPayload(OWNER, { [PROVIDER_EXTENSIONS_FIELD]: {} }),
    ).toEqual({ [PROVIDER_EXTENSIONS_FIELD]: {} });
    expect(
      wrapTopicPayload(OWNER, { [PROVIDER_EXTENSIONS_FIELD]: null }),
    ).toEqual({ [PROVIDER_EXTENSIONS_FIELD]: null });
  });

  it("stays idempotent across a re-decode", () => {
    const once = wrapTopicPayload(OWNER, {
      [PROVIDER_EXTENSIONS_FIELD]: { [PROVIDER]: { burnTimeRemaining: 42.5 } },
    });
    const twice = wrapTopicPayload(OWNER, once) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;

    // A payload is re-decoded on reconnect; a second wrap must not turn
    // {magnitude, unit} into a Value holding a Value.
    expect(
      asValue(twice[PROVIDER_EXTENSIONS_FIELD][PROVIDER].burnTimeRemaining)
        .magnitude,
    ).toBe(42.5);
  });

  it("keys by provider id so two providers on one payload do not collide", () => {
    const other = "otherprovider";
    registerTypeUnits("OtherProviderExt", { pressure: "kPa" });
    registerProviderExtensionShape(OWNER, other, "OtherProviderExt");

    const wrapped = wrapTopicPayload(OWNER, {
      [PROVIDER_EXTENSIONS_FIELD]: {
        [PROVIDER]: { burnTimeRemaining: 42.5 },
        [other]: { pressure: 101.3 },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    const bag = wrapped[PROVIDER_EXTENSIONS_FIELD];
    expect(asValue(bag[PROVIDER].burnTimeRemaining).unit).toBe("s");
    expect(asValue(bag[other].pressure).unit).toBe("kPa");
  });
});
