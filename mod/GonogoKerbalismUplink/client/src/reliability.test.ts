import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reading, ReliabilitySummary } from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  KERBALISM_RELIABILITY_PROVIDER_ID,
  RELIABILITY_SUMMARY_TOPIC,
  readKerbalismReliabilityExt,
} from "./reliability";

// src -> client -> GonogoKerbalismUplink -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const FIXTURE = join(
  MOD_ROOT,
  "golden-fixtures",
  "reliability-extensions.json",
);

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

/**
 * The frame the SERVER actually produced, read off disk.
 *
 * `ReliabilityExtensionWireTests` (this Uplink's own dotnet tests) asserts that
 * the real `KerbalismReliabilityMap` serialised through the real `EnvelopeCodec`
 * equals this file byte for byte. So this is not a hand-authored approximation of
 * a wire frame, it is the wire frame, and the two halves of the proof cannot drift
 * without one of them going red. Same shared-JSON discipline as
 * `mod/golden-fixtures/README.md`, in the C#-to-TS direction.
 */
function serverFrame(): { topic: string; payload: ReliabilitySummary } {
  // The frame is held as a JSON STRING inside the fixture, the shape every other
  // file in mod/golden-fixtures/ uses: the C# side asserts byte equality against
  // it, and a nested object would be reformatted by the repo's JSON formatter.
  const vectors = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    name: string;
    json: string;
  }[];
  const vector = vectors.find(
    (v) => v.name === "summary-with-provider-namespace",
  );
  if (vector === undefined) {
    throw new Error("fixture vector summary-with-provider-namespace not found");
  }
  return JSON.parse(vector.json) as {
    topic: string;
    payload: ReliabilitySummary;
  };
}

describe("kerbalism's namespace of reliability.summary's provider extension bag", () => {
  it("is written under the same provider id the C# backend registers with", () => {
    const src = readFileSync(
      join(MOD_ROOT, "GonogoKerbalismUplink", "KerbalismReliabilityMap.cs"),
      "utf8",
    );
    const m = src.match(/const\s+string\s+ProviderId\s*=\s*"([^"]+)"/);
    expect(m?.[1]).toBe(KERBALISM_RELIABILITY_PROVIDER_ID);

    // And the frame the server produced really does key on it, so the two
    // constants agreeing is not agreement about nothing.
    const frame = serverFrame();
    expect(frame.topic).toBe(RELIABILITY_SUMMARY_TOPIC);
    expect(Object.keys(frame.payload.extensions ?? {})).toContain(
      KERBALISM_RELIABILITY_PROVIDER_ID,
    );
  });

  it("narrows to this Uplink's typed shape, and leaves an unknown provider alone", () => {
    const ext = readKerbalismReliabilityExt(serverFrame().payload);

    expect(ext).toBeDefined();
    expect(ext?.brokenPartCount).toBeDefined();

    // The accessor answers for its OWN namespace only. A payload carrying only
    // some other provider's sub-tree is not this provider's data with fields
    // missing, it is an absence, and the reader has to say so.
    expect(
      readKerbalismReliabilityExt({
        extensions: { someprovider: { depth: 3.5 } },
      }),
    ).toBeUndefined();
    expect(readKerbalismReliabilityExt({})).toBeUndefined();
    expect(readKerbalismReliabilityExt(undefined)).toBeUndefined();
  });

  // The end-to-end assertion this whole mechanism exists to make good on.
  //
  // A quantity inside a provider's namespace is a real gonogo Value and has to
  // survive decode like any other. Nothing in core can know that: the bag is
  // opaque by construction, so `wrapTopicPayload` can only walk into it because
  // ./reliability.ts registered which generated type the namespace holds
  // (registerProviderExtensionShape) and ./topics.ts fed this Uplink's own
  // generated TYPE units in (registerTypeUnits). Delete either and this is the
  // assertion that goes red, with everything else in this file staying green:
  // verified by doing it, both ways, not assumed.
  //
  // Driven through the REAL TelemetryClient/StubTransport pipeline, off the frame
  // the REAL C# codec wrote, so the claim is about the shipped decode path rather
  // than about wrapTopicPayload called in isolation.
  it('hydrates the extension\'s quantity into Value<"s"> at decode time', async () => {
    const frame = serverFrame();
    const fixture = setupStreamFixture({
      carriedChannels: [RELIABILITY_SUMMARY_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RELIABILITY_SUMMARY_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RELIABILITY_SUMMARY_TOPIC, frame.payload);

    await waitFor(() => {
      expect(result.current?.extensions).toBeDefined();
    });

    const ext = readKerbalismReliabilityExt(result.current);
    // A bare number fails this (no `.magnitude`/`.unit` own properties), which is
    // what makes it the non-vacuous half. Seconds, not hours: ReliabilityInfo.mtbf
    // always was seconds, and the field that used to carry it said hours.
    expect(ext?.worstMtbfSeconds).toMatchObject({
      magnitude: 940.5,
      unit: "s",
    });
    expect(ext?.brokenPartCount).toMatchObject({ magnitude: 1, unit: "count" });
    expect(ext?.serviceDuePartCount).toMatchObject({
      magnitude: 2,
      unit: "count",
    });
    // The save-wide difficulty settings ride along, because they are what makes a
    // per-part condition mean anything: how likely a failure is unrepairable, and
    // whether a repair needs kits that may not be aboard.
    expect(ext?.criticalChance).toMatchObject({
      magnitude: 0.25,
      unit: "ratio",
    });
    expect(ext?.requireRepairKits).toBe(true);
  });

  it("leaves the payload's own core fields exactly as the wire sent them", async () => {
    const frame = serverFrame();
    const fixture = setupStreamFixture({
      carriedChannels: [RELIABILITY_SUMMARY_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RELIABILITY_SUMMARY_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RELIABILITY_SUMMARY_TOPIC, frame.payload);

    await waitFor(() => {
      expect(result.current?.source).toBeDefined();
    });

    // The bag is additive: the shared shape's own two fields decode exactly as
    // they would without it, both plain tokens.
    expect(result.current?.source).toBe("kerbalism");
    expect(result.current?.coverage).toBe("modeled");
  });
});
