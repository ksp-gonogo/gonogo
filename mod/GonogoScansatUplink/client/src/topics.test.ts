import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllKnownTopicIds,
  isTopicId,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "./test/setupStreamFixture";
// Side-effect import: registers `scansat.available`/`scansat.scanningVessels`/
// `scansat.science` into the SDK's runtime registry, and feeds this Uplink's own
// generated unit/shape maps into it.
import {
  SCANSAT_AVAILABLE_TOPIC,
  SCANSAT_SCANNING_VESSELS_TOPIC,
  SCANSAT_SCIENCE_TOPIC,
} from "./topics";

// src -> client -> GonogoScansatUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in ScansatUplink.cs, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "ScansatUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in ScansatUplink.cs`);
  }
  return m[1];
}

describe("scansat.available bare-primitive Topic", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(SCANSAT_AVAILABLE_TOPIC).toBe(csTopic("AvailableTopic"));
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(SCANSAT_AVAILABLE_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(SCANSAT_AVAILABLE_TOPIC);
  });
});

describe("scansat structured Topics (relocated out of Sitrep.Contract)", () => {
  it("register the same strings the C# Uplink declares", () => {
    expect(SCANSAT_SCANNING_VESSELS_TOPIC).toBe(
      csTopic("ScanningVesselsTopic"),
    );
    expect(SCANSAT_SCIENCE_TOPIC).toBe(csTopic("ScienceTopic"));
  });

  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [
      SCANSAT_SCANNING_VESSELS_TOPIC,
      SCANSAT_SCIENCE_TOPIC,
    ]) {
      expect(isTopicId(topic)).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });

  // The runtime-hydration half of the uplink-types-out-of-core plan's Unit
  // guard (§5b): a widget/decode test, not just the generated-file type check.
  // Drives the REAL TelemetryClient/StubTransport pipeline (setupStreamFixture),
  // so this proves registerTopicUnits (topics.ts) actually reaches
  // wrapTopicPayload's decode-time lookup. Without that call,
  // subLatitude/altitude/groundTrackWidthDeg would arrive as bare numbers here
  // even though ../__generated__/contract.ts still types them
  // Value<"°">/Value<"m">.
  it('hydrates the vessel\'s own fields into Value<"°">/Value<"m"> at decode time', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [SCANSAT_SCANNING_VESSELS_TOPIC],
    });
    const { result } = renderHook(
      () => useTelemetry(SCANSAT_SCANNING_VESSELS_TOPIC),
      { wrapper: fixture.Provider },
    );

    fixture.emit(SCANSAT_SCANNING_VESSELS_TOPIC, [
      {
        vesselId: "abc",
        vesselName: "Mapper 1",
        body: "Kerbin",
        subLatitude: 12.5,
        subLongitude: -40,
        altitude: 250_000,
        groundTrackWidthDeg: 3.5,
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.subLatitude).toBeDefined();
    });

    const vessel = result.current?.[0];
    // A plain number would fail these (no `.magnitude`/`.unit` own properties):
    // this is the non-vacuous proof the field decoded through wrapTopicPayload
    // rather than passing through bare.
    expect(vessel?.subLatitude).toMatchObject({ magnitude: 12.5, unit: "°" });
    expect(vessel?.subLongitude).toMatchObject({ magnitude: -40, unit: "°" });
    expect(vessel?.altitude).toMatchObject({ magnitude: 250_000, unit: "m" });
    expect(vessel?.groundTrackWidthDeg).toMatchObject({
      magnitude: 3.5,
      unit: "°",
    });
    // vesselId is Units.Id and vesselName/body Units.Text (non-quantity
    // tokens): they stay bare strings, never wrapped.
    expect(vessel?.vesselId).toBe("abc");
    expect(vessel?.body).toBe("Kerbin");
  });

  // The half NO earlier relocation had to solve. wrapTopicPayload learns a field
  // holds another shape from shapesForTopic, then recurses through
  // wrapTypePayload, which resolves that shape BY TYPE NAME via
  // unitsForType/shapesForType. Those read the SDK's TYPE-keyed generated maps,
  // which no longer carry ScanSensorEntry/ScanTrackColor at all, so the topic
  // registration ALONE leaves every nested quantity bare while the generated
  // type still says Value<"m">. This is the assertion that fails if
  // registerTypeUnits is dropped from topics.ts (or from the SDK), and the test
  // above would stay green throughout: the two are not interchangeable.
  it("hydrates NESTED sensor and track-colour fields, not just the vessel's own", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [SCANSAT_SCANNING_VESSELS_TOPIC],
    });
    const { result } = renderHook(
      () => useTelemetry(SCANSAT_SCANNING_VESSELS_TOPIC),
      { wrapper: fixture.Provider },
    );

    fixture.emit(SCANSAT_SCANNING_VESSELS_TOPIC, [
      {
        vesselId: "abc",
        subLatitude: 0,
        sensors: [
          { type: 8, fov: 5, minAlt: 5_000, maxAlt: 500_000, bestAlt: 250_000 },
        ],
        trackColor: { r: 255, g: 128, b: 0, a: 255 },
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.sensors?.[0]?.minAlt).toBeDefined();
    });

    const sensor = result.current?.[0]?.sensors?.[0];
    expect(sensor?.fov).toMatchObject({ magnitude: 5, unit: "°" });
    expect(sensor?.minAlt).toMatchObject({ magnitude: 5_000, unit: "m" });
    expect(sensor?.maxAlt).toMatchObject({ magnitude: 500_000, unit: "m" });
    expect(sensor?.bestAlt).toMatchObject({ magnitude: 250_000, unit: "m" });
    // Units.Id: stays a bare number even three levels down.
    expect(sensor?.type).toBe(8);

    // ScanTrackColor's four channels are Units.Count, an integral 0..255 byte
    // rather than a ratio (see the C# type's own doc comment), so they DO carry
    // a unit and DO wrap.
    const trackColor = result.current?.[0]?.trackColor;
    expect(trackColor?.r).toMatchObject({ magnitude: 255, unit: "count" });
    expect(trackColor?.b).toMatchObject({ magnitude: 0, unit: "count" });
  });

  // scansat.science is the all-non-quantity contrast case: every field is an
  // id/text/flag token, so nothing on it wraps. Registered anyway (topics.ts
  // loops over the generated map rather than naming topics), and asserted here
  // so "nothing wrapped" is a stated property of this Topic rather than an
  // indistinguishable-from-broken silence.
  it("leaves scansat.science bare: it declares no quantities", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [SCANSAT_SCIENCE_TOPIC],
    });
    const { result } = renderHook(() => useTelemetry(SCANSAT_SCIENCE_TOPIC), {
      wrapper: fixture.Provider,
    });

    fixture.emit(SCANSAT_SCIENCE_TOPIC, [
      {
        partId: "17",
        partTitle: "SAR Altimetry Sensor",
        expId: "SCANsatAltimetryHiRes",
        hasData: true,
        rerunnable: true,
        deployed: false,
        inoperable: false,
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.partId).toBeDefined();
    });

    const entry = result.current?.[0];
    expect(entry?.partId).toBe("17");
    expect(entry?.partTitle).toBe("SAR Altimetry Sensor");
    expect(entry?.hasData).toBe(true);
    expect(entry?.inoperable).toBe(false);
  });
});
