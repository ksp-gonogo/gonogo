import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  getAllKnownTopicIds,
  isTopicId,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
// Side-effect import: registers `kerbalism.available` plus the five relocated
// structured Topics into the SDK's runtime registry, and feeds this Uplink's own
// generated unit/shape maps into BOTH halves of it.
import {
  KERBALISM_AVAILABLE_TOPIC,
  KERBALISM_CREW_TOPIC,
  KERBALISM_FEATURES_TOPIC,
  KERBALISM_LIFESUPPORT_TOPIC,
  KERBALISM_PROFILE_TOPIC,
  KERBALISM_SPACEWEATHER_TOPIC,
} from "./topics";

// src -> client -> GonogoKerbalismUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in KerbalismUplink.cs, as the C# declares it. */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the
 * frame. A stale reading with no model gives nothing, because a judgement cannot
 * be dated: the operator reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "KerbalismUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in KerbalismUplink.cs`);
  }
  return m[1];
}

describe("kerbalism.available bare-primitive Topic", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(KERBALISM_AVAILABLE_TOPIC).toBe(csTopic("AvailableTopic"));
  });

  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(KERBALISM_AVAILABLE_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(KERBALISM_AVAILABLE_TOPIC);
  });
});

describe("kerbalism structured Topics (relocated out of Sitrep.Contract)", () => {
  it("register the same strings the C# Uplink declares", () => {
    expect(KERBALISM_SPACEWEATHER_TOPIC).toBe(csTopic("SpaceWeatherTopic"));
    expect(KERBALISM_PROFILE_TOPIC).toBe(csTopic("ProfileTopic"));
    expect(KERBALISM_LIFESUPPORT_TOPIC).toBe(csTopic("LifeSupportTopic"));
    expect(KERBALISM_CREW_TOPIC).toBe(csTopic("CrewTopic"));
    expect(KERBALISM_FEATURES_TOPIC).toBe(csTopic("FeaturesTopic"));
  });

  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [
      KERBALISM_SPACEWEATHER_TOPIC,
      KERBALISM_PROFILE_TOPIC,
      KERBALISM_LIFESUPPORT_TOPIC,
      KERBALISM_CREW_TOPIC,
      KERBALISM_FEATURES_TOPIC,
    ]) {
      expect(isTopicId(topic)).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });

  // Half one: the Topic's OWN fields, registered by `registerTopicUnits`.
  //
  // The runtime-hydration half of the Unit guard: a decode test, not just a
  // generated-file type check. Drives the REAL
  // TelemetryClient/StubTransport pipeline (setupStreamFixture), so this proves
  // registerTopicUnits (topics.ts) actually reaches wrapTopicPayload's
  // decode-time lookup. Without that call, radiationRadPerSecond and
  // stormEjectionSpeed would arrive as bare numbers here even though
  // ./__generated__/contract.ts still types them Value<"rad/s">/Value<"m/s">.
  it('hydrates spaceweather\'s own fields into Value<"rad/s">/Value<"m/s"> at decode time', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_SPACEWEATHER_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_SPACEWEATHER_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(KERBALISM_SPACEWEATHER_TOPIC, {
      radiationRadPerSecond: 0.000_11,
      habitatRadiationRadPerSecond: 0.000_05,
      shieldingAmount: 0,
      stormEjectionSpeed: 99_000_000,
      magnetosphere: true,
      blackout: false,
    });

    await waitFor(() => {
      expect(result.current?.radiationRadPerSecond).toBeDefined();
    });

    // A plain number would fail these (no `.magnitude`/`.unit` own properties):
    // this is the non-vacuous proof the field decoded through wrapTopicPayload
    // rather than passing through bare.
    expect(result.current?.radiationRadPerSecond).toMatchObject({
      magnitude: 0.000_11,
      unit: "rad/s",
    });
    expect(result.current?.habitatRadiationRadPerSecond).toMatchObject({
      magnitude: 0.000_05,
      unit: "rad/s",
    });
    expect(result.current?.stormEjectionSpeed).toMatchObject({
      magnitude: 99_000_000,
      unit: "m/s",
    });
    // A present ZERO is a real reading, not an absence, so it wraps too.
    expect(result.current?.shieldingAmount).toMatchObject({
      magnitude: 0,
      unit: "units",
    });
    // Units.Flag is a non-quantity token: stays a bare boolean, never wrapped.
    expect(result.current?.magnetosphere).toBe(true);
    expect(result.current?.blackout).toBe(false);
  });

  // Half two: NESTED shapes, registered by `registerTypeUnits`.
  //
  // wrapTopicPayload learns a field holds another shape from shapesForTopic, then
  // recurses through wrapTypePayload, which resolves that shape BY TYPE NAME via
  // unitsForType/shapesForType. Those read the SDK's TYPE-keyed generated maps,
  // which no longer carry a single Kerbalism entry, so the topic registration
  // ALONE leaves every nested quantity bare while the generated type still says
  // Value<...>. These are the assertions that fail if the registerTypeUnits loop
  // is dropped from topics.ts (or from the SDK); the topic-level test above stays
  // green throughout, which is what makes the two demonstrably not
  // interchangeable.
  //
  // Verified by doing it, not assumed: deleting that loop turns exactly the four
  // tests below red and leaves the other seven in this file green. Each failure
  // is the bare number where a Value was expected: a per-kerbal dose of 12.5
  // instead of Value<"units">, a star distance of 13599840256 instead of
  // Value<"m">, a habitat volume of 3.5 instead of Value<"m³">, a resource
  // density of 1 instead of Value<"kg/m³">.
  it("hydrates the per-kerbal rule dose nested two levels down", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_CREW_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_CREW_TOPIC)),
      {
        wrapper: fixture.Provider,
      },
    );

    fixture.emit(KERBALISM_CREW_TOPIC, [
      {
        name: "Jebediah Kerman",
        trait: "Pilot",
        deathClockUt: 3_600,
        rules: [
          {
            name: "radiation",
            value: 12.5,
            degenPerSec: 0.000_002,
            fatalThreshold: 50,
          },
          { name: "breathing", value: 0, fatalThreshold: 1 },
        ],
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.rules?.[0]?.value).toBeDefined();
    });

    // The Topic's own field: covered by the TOPIC registry.
    // "ut", not "s": the death clock is the INSTANT the deadline lands on, not
    // the seconds remaining, so a consumer has to subtract the frame's view time
    // and <Countdown> refuses it until they do.
    expect(result.current?.[0]?.deathClockUt).toMatchObject({
      magnitude: 3_600,
      unit: "ut",
    });
    // The nested rule's fields: reachable ONLY through the TYPE registry, since
    // KerbalismCrewRule is not a Topic and the SDK's generated type map does not
    // know it exists any more.
    const dose = result.current?.[0]?.rules?.[0];
    expect(dose?.value).toMatchObject({ magnitude: 12.5, unit: "units" });
    expect(dose?.degenPerSec).toMatchObject({
      magnitude: 0.000_002,
      unit: "units/s",
    });
    expect(dose?.fatalThreshold).toMatchObject({
      magnitude: 50,
      unit: "units",
    });
    // Units.Text: bare even two levels down.
    expect(dose?.name).toBe("radiation");
    // Every element of the array is walked, not just the first, and a field the
    // frame omitted is not minted (degenPerSec never arrived on this rule).
    const second = result.current?.[0]?.rules?.[1];
    expect(second?.value).toMatchObject({ magnitude: 0, unit: "units" });
    expect(second && "degenPerSec" in second).toBe(false);
  });

  it("hydrates a star's distance and carries its Vec3 unit to the three leaves", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_SPACEWEATHER_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_SPACEWEATHER_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(KERBALISM_SPACEWEATHER_TOPIC, {
      stars: [
        {
          star: "Sun",
          distance: 13_599_840_256,
          direction: { x: 0, y: 1, z: 0 },
        },
      ],
      storms: [
        {
          star: "Sun",
          stormState: 1,
          stormTime: 12_345_678,
          stormDuration: 7_200,
          dist: 13_599_840_256,
        },
      ],
    });

    await waitFor(() => {
      expect(result.current?.stars?.[0]?.distance).toBeDefined();
    });

    const star = result.current?.stars?.[0];
    expect(star?.distance).toMatchObject({
      magnitude: 13_599_840_256,
      unit: "m",
    });
    expect(star?.star).toBe("Sun");
    // A Vec3 on a NESTED type: no earlier relocated slice had one at all, let
    // alone one reached through an array. The unit is declared on the FIELD and
    // emitted as three dotted leaf keys, so proving it arrived means checking
    // the leaves, not the parent.
    expect(star?.direction?.x).toMatchObject({ magnitude: 0, unit: "1" });
    expect(star?.direction?.y).toMatchObject({ magnitude: 1, unit: "1" });
    expect(star?.direction?.z).toMatchObject({ magnitude: 0, unit: "1" });

    const storm = result.current?.storms?.[0];
    // Two time fields on one entry, carrying different time units: the arrival
    // is an INSTANT on the universal-time clock, the duration is an interval.
    // Reading `stormTime` as seconds-until is the mistake the split exists to
    // stop, and `<Countdown>` now refuses it outright.
    expect(storm?.stormTime).toMatchObject({
      magnitude: 12_345_678,
      unit: "ut",
    });
    expect(storm?.stormDuration).toMatchObject({ magnitude: 7_200, unit: "s" });
    expect(storm?.dist).toMatchObject({ magnitude: 13_599_840_256, unit: "m" });
  });

  it("hydrates the life-support habitat, processes and greenhouses", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_LIFESUPPORT_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_LIFESUPPORT_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(KERBALISM_LIFESUPPORT_TOPIC, {
      habitat: { pressure: 1, volume: 3.5, surface: 12.25 },
      processes: [
        {
          resource: "_Scrubber",
          title: "CO2 Scrubber",
          capacity: 1,
          running: true,
          flightId: 4_294_967_295,
          valveIndex: 0,
          envModifier: 0.8,
        },
      ],
      greenhouses: [
        { cropResource: "Food", natural: 1_360, foodRatePerSec: 0.000_1 },
      ],
    });

    await waitFor(() => {
      expect(result.current?.habitat?.volume).toBeDefined();
    });

    expect(result.current?.habitat?.volume).toMatchObject({
      magnitude: 3.5,
      unit: "m³",
    });
    expect(result.current?.habitat?.surface).toMatchObject({
      magnitude: 12.25,
      unit: "m²",
    });

    const process = result.current?.processes?.[0];
    expect(process?.capacity).toMatchObject({ magnitude: 1, unit: "units" });
    expect(process?.envModifier).toMatchObject({ magnitude: 0.8, unit: "1" });
    expect(process?.valveIndex).toMatchObject({ magnitude: 0, unit: "count" });
    // Units.Id: flightId joins onto a part in the ship diagram, so arithmetic on
    // it is meaningless and it stays a bare number.
    expect(process?.flightId).toBe(4_294_967_295);
    expect(process?.running).toBe(true);

    const greenhouse = result.current?.greenhouses?.[0];
    expect(greenhouse?.natural).toMatchObject({
      magnitude: 1_360,
      unit: "W/m²",
    });
    expect(greenhouse?.foodRatePerSec).toMatchObject({
      magnitude: 0.000_1,
      unit: "units/s",
    });
  });

  // The name-keyed-map form, which this Domain is now the only holder of
  // anywhere in the contract: the unit belongs to each VALUE and the key is a
  // resource/rule NAME, so nothing may camel-case it. Both halves appear here:
  // `rates`/`ruleEnvModifiers` are maps of bare SCALARS on the Topic itself,
  // and `profile.resources` is a map of nested SHAPES (the `*`-prefixed shape
  // entry), which only the TYPE registry can resolve.
  it("wraps every value of a name-keyed rate map, keys untouched", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_LIFESUPPORT_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_LIFESUPPORT_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(KERBALISM_LIFESUPPORT_TOPIC, {
      rates: { Water: -0.000_054, ElectricCharge: -0.1856, Nitrogen: 0 },
      ruleEnvModifiers: { radiation: 1.5 },
    });

    await waitFor(() => {
      expect(result.current?.rates?.Water).toBeDefined();
    });

    expect(result.current?.rates?.Water).toMatchObject({
      magnitude: -0.000_054,
      unit: "units/s",
    });
    // The key is data, not a property name, so nothing camel-cases it.
    expect(Object.keys(result.current?.rates ?? {})).toContain(
      "ElectricCharge",
    );
    // A present ZERO is a real, measured zero (in balance), not an absence.
    expect(result.current?.rates?.Nitrogen).toMatchObject({
      magnitude: 0,
      unit: "units/s",
    });
    expect(result.current?.ruleEnvModifiers?.radiation).toMatchObject({
      magnitude: 1.5,
      unit: "1",
    });
  });

  it("hydrates a profile resource definition through the map-of-shapes entry", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_PROFILE_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_PROFILE_TOPIC)),
      {
        wrapper: fixture.Provider,
      },
    );

    fixture.emit(KERBALISM_PROFILE_TOPIC, {
      name: "Default",
      resources: {
        Water: {
          flowMode: "ALL_VESSEL",
          flowModeOrdinal: 1,
          density: 1.0,
          isSupply: true,
          lowThreshold: 0.15,
        },
      },
      rules: [
        {
          name: "drinking",
          input: "Water",
          ratePerSecond: 0.000_2,
          rate: 1.08,
          interval: 5_400,
        },
      ],
      processes: [
        {
          name: "scrubber",
          inputs: { ElectricCharge: 0.025 },
          outputs: { Water: 0.001 },
        },
      ],
    });

    await waitFor(() => {
      expect(result.current?.resources?.Water?.density).toBeDefined();
    });

    // KerbalismProfile.resources is Dictionary<string, KerbalismResourceDef>,
    // emitted as the `*KerbalismResourceDef` shape entry: the VALUES are the
    // payloads, so treating the dictionary itself as one would look for
    // `density` on the map and find nothing.
    const water = result.current?.resources?.Water;
    expect(water?.density).toMatchObject({ magnitude: 1.0, unit: "kg/m³" });
    expect(water?.lowThreshold).toMatchObject({
      magnitude: 0.15,
      unit: "ratio",
    });
    expect(water?.flowMode).toBe("ALL_VESSEL");
    expect(water?.isSupply).toBe(true);

    const rule = result.current?.rules?.[0];
    expect(rule?.ratePerSecond).toMatchObject({
      magnitude: 0.000_2,
      unit: "units/s",
    });
    expect(rule?.interval).toMatchObject({ magnitude: 5_400, unit: "s" });

    // A nested type whose OWN field is a name-keyed scalar map: the deepest form
    // this Domain carries.
    const process = result.current?.processes?.[0];
    expect(process?.inputs?.ElectricCharge).toMatchObject({
      magnitude: 0.025,
      unit: "units/s",
    });
    expect(process?.outputs?.Water).toMatchObject({
      magnitude: 0.001,
      unit: "units/s",
    });
  });

  // kerbalism.features is the all-non-quantity contrast case: every field is a
  // flag, so nothing on it wraps. Registered anyway (topics.ts loops over the
  // generated map rather than naming topics), and asserted here so "nothing
  // wrapped" is a stated property of this Topic rather than an
  // indistinguishable-from-broken silence.
  it("leaves kerbalism.features bare: it declares no quantities", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_FEATURES_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(KERBALISM_FEATURES_TOPIC)),
      {
        wrapper: fixture.Provider,
      },
    );

    fixture.emit(KERBALISM_FEATURES_TOPIC, {
      reliability: false,
      radiation: true,
      supplies: true,
    });

    await waitFor(() => {
      expect(result.current?.radiation).toBeDefined();
    });

    expect(result.current?.reliability).toBe(false);
    expect(result.current?.radiation).toBe(true);
    expect(result.current?.supplies).toBe(true);
  });
});
