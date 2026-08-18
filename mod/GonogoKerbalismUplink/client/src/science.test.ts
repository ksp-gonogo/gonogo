import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExperimentBreakdownEntry,
  ExperimentEntry,
  InstrumentEntry,
  LabEntry,
} from "@ksp-gonogo/sitrep-sdk";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  KERBALISM_SCIENCE_PROVIDER_ID,
  KERBALISM_SCIENCE_VALUE_MODEL,
  readKerbalismScienceBreakdownExt,
  readKerbalismScienceExperimentExt,
  readKerbalismScienceInstrumentExt,
  readKerbalismScienceLabExt,
  SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
  SCIENCE_EXPERIMENTS_TOPIC,
  SCIENCE_INSTRUMENTS_TOPIC,
  SCIENCE_LAB_TOPIC,
} from "./science";
import { setupStreamFixture } from "./test/setupStreamFixture";

// src -> client -> GonogoKerbalismUplink -> mod
const MOD_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const FIXTURE = join(MOD_ROOT, "golden-fixtures", "science-extensions.json");

/**
 * A frame the SERVER actually produced, read off disk.
 *
 * `ScienceExtensionWireTests` (this Uplink's own dotnet tests) asserts that the real
 * `KerbalismScienceMap` serialised through the real `EnvelopeCodec` equals these
 * vectors byte for byte. So these are not hand-authored approximations of wire
 * frames, they ARE the wire frames, and the two halves of the proof cannot drift
 * without one of them going red.
 */
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
  const { result } = renderHook(() => useTelemetry(topic), {
    wrapper: fixture.Provider,
  });

  fixture.emit(topic, payload);

  await waitFor(() => {
    expect(result.current).toBeDefined();
  });
  return result.current as T;
}

describe("kerbalism's namespaces of the elected science.* payloads", () => {
  it("are written under the same provider id the C# map keys them by", () => {
    const src = readFileSync(
      join(MOD_ROOT, "GonogoKerbalismUplink", "KerbalismScienceMap.cs"),
      "utf8",
    );
    expect(src.match(/const\s+string\s+ProviderId\s*=\s*"([^"]+)"/)?.[1]).toBe(
      KERBALISM_SCIENCE_PROVIDER_ID,
    );
    // The value-model tag too: a widget branches on this string, so a rename on
    // one side only would silently stop matching.
    expect(src.match(/const\s+string\s+ValueModel\s*=\s*"([^"]+)"/)?.[1]).toBe(
      KERBALISM_SCIENCE_VALUE_MODEL,
    );

    // And the frames the server produced really do key on it, so the two constants
    // agreeing is not agreement about nothing.
    const frame = serverFrame<ExperimentEntry[]>("experiments-kerbalism");
    expect(frame.topic).toBe(SCIENCE_EXPERIMENTS_TOPIC);
    expect(Object.keys(frame.payload[0]?.extensions ?? {})).toContain(
      KERBALISM_SCIENCE_PROVIDER_ID,
    );
  });

  it("narrow to this Uplink's typed shapes, and leave an unknown provider alone", () => {
    const entry = serverFrame<ExperimentEntry[]>("experiments-kerbalism")
      .payload[0];
    const ext = readKerbalismScienceExperimentExt(entry);

    expect(ext).toBeDefined();
    expect(ext?.kind).toBe("file");

    // Each accessor answers for its OWN namespace only. A payload carrying some
    // other provider's sub-tree is not this provider's data with fields missing, it
    // is an absence, and the reader has to say so.
    expect(
      readKerbalismScienceExperimentExt({
        extensions: { someprovider: { dataSizeMB: 1 } },
      }),
    ).toBeUndefined();
    expect(readKerbalismScienceExperimentExt({})).toBeUndefined();
    expect(readKerbalismScienceExperimentExt(undefined)).toBeUndefined();
    expect(readKerbalismScienceInstrumentExt(undefined)).toBeUndefined();
    expect(readKerbalismScienceLabExt(undefined)).toBeUndefined();
    expect(readKerbalismScienceBreakdownExt(undefined)).toBeUndefined();
  });

  // ── The end-to-end assertion this whole mechanism exists to make good on ──────
  //
  // A quantity inside a provider's namespace is a real gonogo Value and has to
  // survive decode like any other. Nothing in core can know that: the bag is opaque
  // by construction, so `wrapTopicPayload` can only walk into it because
  // ./science.ts registered which generated type each namespace holds
  // (registerProviderExtensionShape) and ./topics.ts fed this Uplink's own generated
  // TYPE units in (registerTypeUnits). Delete either and this is the assertion that
  // goes red with the rest of the file staying green.
  //
  // Doubly load-bearing here, and in a way reliability's equivalent was not:
  // "MB"/"MB/s"/"science/MB" are units the first-party catalog has never heard of, so
  // ./science.ts also has to teach the model their dimensions with `registerUnit`.
  // `wrapTopicPayload` treats a token the model does not know as a NON-quantity and
  // leaves it a bare number, so without those calls the generated type would claim
  // `Value<"MB">` over a plain number and nothing else would complain.
  it('hydrates an extension\'s megabyte figures into Value<"MB"> at decode time', async () => {
    const frame = serverFrame<ExperimentEntry[]>("experiments-kerbalism");
    const entries = await decoded<ExperimentEntry[]>(
      SCIENCE_EXPERIMENTS_TOPIC,
      frame.payload,
    );

    const file = readKerbalismScienceExperimentExt(entries[0]);
    // A bare number fails this (no `.magnitude`/`.unit` own properties), which is
    // what makes it the non-vacuous half.
    expect(file?.dataSizeMB).toMatchObject({ magnitude: 12.5, unit: "MB" });
    expect(file?.storageCapacityMB).toMatchObject({
      magnitude: 512,
      unit: "MB",
    });
    expect(file?.transmitRateMBps).toMatchObject({
      magnitude: 0.004,
      unit: "MB/s",
    });
    expect(file?.sciencePerMB).toMatchObject({
      magnitude: 1.6,
      unit: "science/MB",
    });
    expect(file?.sampleSlotsTotal).toMatchObject({
      magnitude: 2,
      unit: "count",
    });
    // Non-quantity tokens stay bare, the same as anywhere else on the wire.
    expect(file?.kind).toBe("file");
    expect(file?.transmitting).toBe(true);
    expect(file?.sendFlagged).toBe(true);

    const sample = readKerbalismScienceExperimentExt(entries[1]);
    expect(sample?.kind).toBe("sample");
    expect(sample?.sampleMass).toMatchObject({ magnitude: 0.0125, unit: "t" });
    expect(sample?.analyze).toBe(true);
    expect(sample?.sendFlagged).toBeNull();
  });

  it("hydrates the instrument, lab and breakdown namespaces too", async () => {
    const instruments = await decoded<InstrumentEntry[]>(
      SCIENCE_INSTRUMENTS_TOPIC,
      serverFrame<InstrumentEntry[]>("instruments-kerbalism").payload,
    );
    const blocked = readKerbalismScienceInstrumentExt(instruments[0]);
    // The field an operator actually wants: WHY it is not running. A free string,
    // so it stays bare; the rate beside it is a quantity and does not.
    expect(blocked?.issue).toBe("no storage");
    expect(blocked?.expStatus).toBe("Issue");
    expect(blocked?.dataRateMBps).toMatchObject({
      magnitude: 0.002,
      unit: "MB/s",
    });
    expect(blocked?.kind).toBe("experiment");

    const labs = await decoded<LabEntry[]>(
      SCIENCE_LAB_TOPIC,
      serverFrame<LabEntry[]>("lab-kerbalism").payload,
    );
    const lab = readKerbalismScienceLabExt(labs[0]);
    expect(lab?.effectiveRateMBps).toMatchObject({
      magnitude: 0.0012,
      unit: "MB/s",
    });
    expect(lab?.status).toBe("RUNNING");

    const rollups = await decoded<ExperimentBreakdownEntry[]>(
      SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
      serverFrame<ExperimentBreakdownEntry[]>("breakdown-kerbalism").payload,
    );
    const ledger = readKerbalismScienceBreakdownExt(rollups[0]);
    expect(ledger?.scienceRemainingTotal).toMatchObject({
      magnitude: 30,
      unit: "science",
    });
    expect(ledger?.timesCompleted).toMatchObject({
      magnitude: 1,
      unit: "count",
    });
  });

  it("carries a SCANsat scanner Kerbalism took over, on the same instrument channel", async () => {
    // With both mods installed, Kerbalism's support patch deletes the part's
    // SCANexperiment module, so this row is the only report of that scanner
    // anywhere: SCANsat's own reader finds nothing to describe.
    const instruments = await decoded<InstrumentEntry[]>(
      SCIENCE_INSTRUMENTS_TOPIC,
      serverFrame<InstrumentEntry[]>("instruments-kerbalism").payload,
    );
    const scanner = instruments.find(
      (i) => i.partId === "501",
    ) as InstrumentEntry;
    const ext = readKerbalismScienceInstrumentExt(scanner);

    expect(ext?.kind).toBe("scanner");
    // Stopped for want of EC, and Kerbalism's own words for why survive the trip.
    expect(ext?.scanning).toBe(false);
    expect(ext?.powerDisabled).toBe(true);
    expect(ext?.issue).toBe("no storage available");
    // The quantities arrive wrapped, so a widget renders them through Unit rather
    // than guessing that one is a percentage and the other a charge rate.
    expect(ext?.bodyCoveragePercent).toMatchObject({ magnitude: 0, unit: "%" });
    expect(ext?.ecRate).toMatchObject({ magnitude: 1, unit: "units/s" });
    // The experiment-only half of the bag is absent rather than zeroed.
    expect(ext?.dataRateMBps).toBeUndefined();
  });

  it("tags the shared payload so a widget cannot compare two providers' science numbers by accident", async () => {
    const entries = await decoded<ExperimentEntry[]>(
      SCIENCE_EXPERIMENTS_TOPIC,
      serverFrame<ExperimentEntry[]>("experiments-kerbalism").payload,
    );

    expect(entries[0]?.valueModel).toBe(KERBALISM_SCIENCE_VALUE_MODEL);
    // And the unit-mismatched core fields really are absent rather than carrying a
    // megabyte figure under a mits label: the reason the bag exists on this payload.
    expect(entries[0]?.dataAmount).toBeNull();
    expect(entries[0]?.baseTransmitValue).toBeNull();
    expect(entries[0]?.transmitBonus).toBeNull();
    // The shared fields Kerbalism CAN fill are filled, so a widget that reads only
    // core still shows a real row rather than an empty one.
    expect(entries[0]?.subjectId).toBe("radiationScan@KerbinInSpaceLow");
    expect(entries[0]?.title).toBe("Radiation Scan");
    expect(entries[0]?.location).toBe("container");
  });
});
