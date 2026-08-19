import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  IsruConverterEntry,
  IsruDrillEntry,
  Reading,
} from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  ISRU_CONVERTERS_TOPIC,
  ISRU_DRILLS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  readKerbalismIsruConverterExt,
  readKerbalismIsruDrillExt,
} from "./isru";

// src -> client -> GonogoKerbalismUplink -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const FIXTURE = join(MOD_ROOT, "golden-fixtures", "isru-extensions.json");

/**
 * A frame the SERVER actually produced, read off disk.
 *
 * `IsruExtensionWireTests` (this Uplink's own dotnet tests) asserts that the real
 * `KerbalismIsruMap` serialised through the real `EnvelopeCodec` equals these vectors
 * byte for byte. So these are not hand-authored approximations of wire frames, they
 * ARE the wire frames, and the two halves of the proof cannot drift without one of
 * them going red.
 */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

function serverFrame<T>(name: string): { topic: string; payload: T } {
  const vectors = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    name: string;
    json: string;
  }[];
  const vector = vectors.find((v) => v.name === name);
  if (vector === undefined) {
    throw new Error(`fixture vector ${name} not found`);
  }
  return JSON.parse(vector.json) as { topic: string; payload: T };
}

/** Drive one frame through the real client pipeline and hand back what a widget would see. */
async function decoded<T>(topic: string, payload: unknown): Promise<T> {
  const fixture = setupStreamFixture({ carriedChannels: [topic] });
  const { result } = renderHook(() => judgeable(useTelemetry(topic)), {
    wrapper: fixture.Provider,
  });

  fixture.emit(topic, payload);

  // The hook read above is wrapped in `judgeable`, so `result.current` is the
  // PAYLOAD, as it was before `useTelemetry` began answering with a `Reading`.
  // Without that wrap this wait passes on the first tick, because a `Reading` is
  // always defined, and every hydration assertion reads `undefined` off the wrapper.
  await waitFor(() => {
    expect(result.current).toBeDefined();
  });
  return result.current as T;
}

describe("kerbalism's namespaces of the elected isru.* payloads", () => {
  it("are written under the same provider id the C# map keys them by", () => {
    const src = readFileSync(
      join(MOD_ROOT, "GonogoKerbalismUplink", "KerbalismIsruMap.cs"),
      "utf8",
    );
    expect(src.match(/const\s+string\s+ProviderId\s*=\s*"([^"]+)"/)?.[1]).toBe(
      KERBALISM_ISRU_PROVIDER_ID,
    );

    // And the frames the server produced really do key on it, so the two constants
    // agreeing is not agreement about nothing.
    const frame = serverFrame<IsruDrillEntry[]>("drills-kerbalism");
    expect(frame.topic).toBe(ISRU_DRILLS_TOPIC);
    expect(Object.keys(frame.payload[0]?.extensions ?? {})).toContain(
      KERBALISM_ISRU_PROVIDER_ID,
    );
  });

  it("narrow to this Uplink's typed shapes, and leave an unknown provider alone", () => {
    const entry = serverFrame<IsruDrillEntry[]>("drills-kerbalism").payload[1];
    const ext = readKerbalismIsruDrillExt(entry);

    expect(ext).toBeDefined();
    expect(ext?.issue).toBe("not deployed");

    // Each accessor answers for its OWN namespace only. A payload carrying some
    // other provider's sub-tree is not this provider's data with fields missing, it
    // is an absence, and the reader has to say so.
    expect(
      readKerbalismIsruDrillExt({
        extensions: { someprovider: { issue: "made up" } },
      }),
    ).toBeUndefined();
    expect(readKerbalismIsruDrillExt({})).toBeUndefined();
    expect(readKerbalismIsruDrillExt(undefined)).toBeUndefined();
    expect(readKerbalismIsruConverterExt(undefined)).toBeUndefined();
  });

  // ── The end-to-end assertion this whole mechanism exists to make good on ──────
  //
  // A quantity inside a provider's namespace is a real gonogo Value and has to
  // survive decode like any other. Nothing in core can know that: the bag is opaque
  // by construction, so `wrapTopicPayload` can only walk into it because ./isru.ts
  // registered which generated type each namespace holds
  // (`registerProviderExtensionShape`) and ./topics.ts fed this Uplink's own
  // generated TYPE units in (`registerTypeUnits`). Delete either and this is the
  // assertion that goes red with the rest of the file staying green.
  //
  // Unlike this Uplink's science bags, no `registerUnit` call is involved: every unit
  // here is already in the first-party catalog. So this isolates the SHAPE
  // registration as the load-bearing half, which the science proof could not.
  it("hydrates an extension's quantities into wrapped Values at decode time", async () => {
    const entries = await decoded<IsruDrillEntry[]>(
      ISRU_DRILLS_TOPIC,
      serverFrame<IsruDrillEntry[]>("drills-kerbalism").payload,
    );

    const surface = readKerbalismIsruDrillExt(entries[0]);
    // A bare number fails this (no `.magnitude`/`.unit` own properties), which is
    // what makes it the non-vacuous half.
    expect(surface?.ecRate).toMatchObject({ magnitude: 1.5, unit: "units/s" });
    // Nothing wrong with this drill, so the diagnostic is absent rather than "".
    expect(surface?.issue).toBeNull();
    // A free string stays bare, the same as anywhere else on the wire.
    expect(surface?.harvestType).toBe("0");

    const asteroid = readKerbalismIsruDrillExt(entries[1]);
    expect(asteroid?.sourceMassRemaining).toMatchObject({
      magnitude: 18.25,
      unit: "t",
    });
    expect(asteroid?.sourceMassThreshold).toMatchObject({
      magnitude: 2.5,
      unit: "t",
    });
    expect(asteroid?.harvestType).toBe("4");
  });

  it("hydrates the converter namespace too", async () => {
    const entries = await decoded<IsruConverterEntry[]>(
      ISRU_CONVERTERS_TOPIC,
      serverFrame<IsruConverterEntry[]>("converters-kerbalism").payload,
    );

    const plant = readKerbalismIsruConverterExt(entries[0]);
    expect(plant?.processToken).toBe("_MoltenRegolithElectrolysis");
    expect(plant?.title).toBe("Molten Regolith Electrolysis");
    expect(plant?.capacity).toMatchObject({ magnitude: 2, unit: "units" });
    expect(plant?.valveIndex).toMatchObject({ magnitude: 1, unit: "count" });
    expect(plant?.broken).toBe(false);

    const scrubber = readKerbalismIsruConverterExt(entries[1]);
    expect(scrubber?.broken).toBe(true);
  });

  // ── What separates this bag from the science one ─────────────────────────────
  //
  // Kerbalism's science has to leave core fields null, because its figures are in
  // megabytes and core's are in mits. Its ISRU does not: a Kerbalism drill's rate is
  // in the same resource units a stock drill's is. So the shared shape is fully
  // filled and a widget that never imports the accessors above still renders a
  // complete, correct row.
  it("fills every shared field, so a core-only widget renders a complete row", async () => {
    const entries = await decoded<IsruDrillEntry[]>(
      ISRU_DRILLS_TOPIC,
      serverFrame<IsruDrillEntry[]>("drills-kerbalism").payload,
    );

    expect(entries[0]?.partId).toBe("101");
    expect(entries[0]?.resource).toBe("Ore");
    expect(entries[0]?.deployed).toBe(true);
    expect(entries[0]?.running).toBe(true);
    expect(entries[0]?.abundance).toMatchObject({
      magnitude: 0.075,
      unit: "ratio",
    });
    expect(entries[0]?.rate).toMatchObject({
      magnitude: 0.00375,
      unit: "units/s",
    });

    // A stopped drill reports a real zero rather than an absence, so a renderer never
    // has to decide what a null rate on a stopped drill means.
    expect(entries[1]?.running).toBe(false);
    expect(entries[1]?.rate).toMatchObject({ magnitude: 0, unit: "units/s" });
  });

  // Kerbalism runs a CO2 scrubber and a regolith-electrolysis plant on the same
  // module, so this channel carries both. Filtering would mean gonogo asserting a
  // taxonomy the engine does not draw; the deliberate cost is that the same part also
  // appears on kerbalism.lifesupport, from the supply side.
  it("carries life-support processes alongside ISRU ones, unfiltered", async () => {
    const entries = await decoded<IsruConverterEntry[]>(
      ISRU_CONVERTERS_TOPIC,
      serverFrame<IsruConverterEntry[]>("converters-kerbalism").payload,
    );

    expect(entries).toHaveLength(2);
    const scrubber = entries.find((e) => e.partId === "202");
    expect(scrubber?.inputs.map((f) => f.resource)).toContain("CarbonDioxide");
    expect(scrubber?.outputs.map((f) => f.resource)).toContain("Oxygen");
  });
});
