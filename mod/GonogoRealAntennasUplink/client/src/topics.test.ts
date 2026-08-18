import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllKnownTopicIds,
  isTopicId,
  unitsForTopic,
  unitsForType,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "./test/setupStreamFixture";
// Side-effect import: registers the three RA-only Topics into the SDK's runtime
// registry and feeds this Uplink's own generated unit/shape maps into BOTH
// halves of the relocated unit registry.
import {
  COMMS_DATA_RATE_TOPIC,
  COMMS_LINK_MARGIN_TOPIC,
  COMMS_LINK_QUALITY_TOPIC,
} from "./topics";

// src -> client -> GonogoRealAntennasUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in RealAntennasUplink.cs, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "RealAntennasUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in RealAntennasUplink.cs`);
  }
  return m[1];
}

describe("the three RA-only Topics (relocated out of Sitrep.Contract)", () => {
  it.each([
    ["LinkQualityTopic", COMMS_LINK_QUALITY_TOPIC],
    ["DataRateTopic", COMMS_DATA_RATE_TOPIC],
    ["LinkMarginTopic", COMMS_LINK_MARGIN_TOPIC],
  ])("%s registers the same string the C# Uplink declares", (name, topic) => {
    expect(topic).toBe(csTopic(name));
  });

  // These used to be static members of the SDK's own TOPIC_IDS, because their
  // payload types lived in Sitrep.Contract and carried [SitrepTopic]. They are
  // now runtime registrations from this client, so this assertion is what stands
  // between the relocation and `isTopicId("comms.linkMargin")` silently going
  // false for every consumer.
  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [
      COMMS_LINK_QUALITY_TOPIC,
      COMMS_DATA_RATE_TOPIC,
      COMMS_LINK_MARGIN_TOPIC,
    ]) {
      expect(isTopicId(topic), `${topic} is not a known TopicId`).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });
});

// ── The relocated unit registry, proved by DECODE ────────────────────────────────
//
// The slice before this one had nothing for a Value to be (identifiers and state
// names only) and had to assert the registry instead. This one is the opposite:
// four of its five declared units name a real dimension, so the registration has
// a visible decode-time effect and the honest proof is to drive a frame through
// the REAL TelemetryClient/StubTransport pipeline and look at what comes out.
//
// Non-vacuous by construction: delete the registerTopicUnits loop in topics.ts and
// every `toMatchObject({ magnitude, unit })` below fails with a bare number.
describe("registerTopicUnits: hydration at decode time", () => {
  it('hydrates the margin into a Value<"dB">, not a bare number', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [COMMS_LINK_MARGIN_TOPIC],
    });
    const { result } = renderHook(() => useTelemetry(COMMS_LINK_MARGIN_TOPIC), {
      wrapper: fixture.Provider,
    });

    fixture.emit(COMMS_LINK_MARGIN_TOPIC, {
      decibelMargin: 3.5,
      closesLink: true,
      meta: { source: "vessel:1", quality: 1 },
    });

    await waitFor(() => {
      expect(result.current?.decibelMargin).toBeDefined();
    });

    // A plain number would fail this (no `.magnitude`/`.unit` own properties).
    expect(result.current?.decibelMargin).toMatchObject({
      magnitude: 3.5,
      unit: "dB",
    });
    // closesLink declares Units.Flag, a non-quantity token, so it stays a bare
    // boolean: the contrast that ties the wrapping to the TOKEN rather than to
    // "this field was annotated".
    expect(result.current?.closesLink).toBe(true);
  });

  it("hydrates both data-rate directions", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [COMMS_DATA_RATE_TOPIC],
    });
    const { result } = renderHook(() => useTelemetry(COMMS_DATA_RATE_TOPIC), {
      wrapper: fixture.Provider,
    });

    fixture.emit(COMMS_DATA_RATE_TOPIC, {
      upBitsPerSec: 1000,
      downBitsPerSec: 2000,
      meta: { source: "vessel:1", quality: 1 },
    });

    await waitFor(() => {
      expect(result.current?.upBitsPerSec).toBeDefined();
    });

    expect(result.current?.upBitsPerSec).toMatchObject({
      magnitude: 1000,
      unit: "bit/s",
    });
    expect(result.current?.downBitsPerSec).toMatchObject({
      magnitude: 2000,
      unit: "bit/s",
    });
  });

  it('hydrates the quality ratio into a Value<"ratio">', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [COMMS_LINK_QUALITY_TOPIC],
    });
    const { result } = renderHook(
      () => useTelemetry(COMMS_LINK_QUALITY_TOPIC),
      { wrapper: fixture.Provider },
    );

    fixture.emit(COMMS_LINK_QUALITY_TOPIC, {
      value: 0.9,
      meta: { source: "vessel:1", quality: 1 },
    });

    await waitFor(() => {
      expect(result.current?.value).toBeDefined();
    });

    expect(result.current?.value).toMatchObject({
      magnitude: 0.9,
      unit: "ratio",
    });
  });

  // The lookup itself, alongside the decode. The decode above would still pass if
  // the loop registered only the two topics it exercises richly, and a Topic
  // silently dropping out of the registry is the regression a widened contract is
  // most likely to introduce.
  it("restores unitsForTopic for all three relocated Topics", () => {
    expect(unitsForTopic(COMMS_LINK_QUALITY_TOPIC)).toEqual({ value: "ratio" });
    expect(unitsForTopic(COMMS_DATA_RATE_TOPIC)).toEqual({
      upBitsPerSec: "bit/s",
      downBitsPerSec: "bit/s",
    });
    expect(unitsForTopic(COMMS_LINK_MARGIN_TOPIC)).toEqual({
      decibelMargin: "dB",
      closesLink: "flag",
    });
  });
});

describe("registerTypeUnits: the type-keyed half", () => {
  // Nothing in this slice nests, so no Topic's shape map reaches these entries
  // today and no decode goes through them. They are registered anyway, by the
  // same generic loop, and this is what would catch that loop being dropped as
  // "unused" by a future reader who checked only the decode.
  it("restores unitsForType for all three relocated types", () => {
    expect(unitsForType("CommsLinkQuality").value).toBe("ratio");
    expect(unitsForType("CommsDataRate").upBitsPerSec).toBe("bit/s");
    expect(unitsForType("CommsLinkMargin").decibelMargin).toBe("dB");
  });
});
