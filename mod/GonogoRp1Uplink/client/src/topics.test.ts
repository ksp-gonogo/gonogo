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
// Side-effect import: registers every rp1.* Topic and feeds this Uplink's own
// generated unit and shape maps into the decode-time registry.
import "./units";
import {
  RP1_AVAILABLE_TOPIC,
  RP1_BUILD_QUEUE_TOPIC,
  RP1_CENTRES_TOPIC,
  RP1_COMPLEXES_TOPIC,
  RP1_CONFIDENCE_TOPIC,
  RP1_OPERATIONS_TOPIC,
  RP1_PADS_TOPIC,
  RP1_PERSONNEL_TOPIC,
  RP1_PROGRAM_SLOTS_TOPIC,
  RP1_PROGRAMS_TOPIC,
  RP1_RESEARCH_TOPIC,
  RP1_WAREHOUSE_TOPIC,
} from "./topics";

// src -> client -> GonogoRp1Uplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in Rp1ScUplink.cs, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "Rp1ScUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in Rp1ScUplink.cs`);
  }
  return m[1];
}

/**
 * A value only where one is current. The halves of the payload this Uplink is
 * careful about are absences, and a stale reading is a third thing again.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

describe("the rp1.* Topic registrations", () => {
  it("register the same strings the C# Uplink declares", () => {
    // The two halves ship together and are versioned together, so a topic
    // renamed on one side and not the other is a rename nothing else catches.
    expect(RP1_AVAILABLE_TOPIC).toBe(csTopic("AvailableTopic"));
    expect(RP1_CENTRES_TOPIC).toBe(csTopic("CentresTopic"));
    expect(RP1_COMPLEXES_TOPIC).toBe(csTopic("ComplexesTopic"));
    expect(RP1_BUILD_QUEUE_TOPIC).toBe(csTopic("BuildQueueTopic"));
    expect(RP1_WAREHOUSE_TOPIC).toBe(csTopic("WarehouseTopic"));
    expect(RP1_PADS_TOPIC).toBe(csTopic("PadsTopic"));
    expect(RP1_OPERATIONS_TOPIC).toBe(csTopic("OperationsTopic"));
    expect(RP1_RESEARCH_TOPIC).toBe(csTopic("ResearchTopic"));
    expect(RP1_PERSONNEL_TOPIC).toBe(csTopic("PersonnelTopic"));
    expect(RP1_CONFIDENCE_TOPIC).toBe(csTopic("ConfidenceTopic"));
    expect(RP1_PROGRAMS_TOPIC).toBe(csTopic("ProgramsTopic"));
    expect(RP1_PROGRAM_SLOTS_TOPIC).toBe(csTopic("ProgramSlotsTopic"));
  });

  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [
      RP1_AVAILABLE_TOPIC,
      RP1_CENTRES_TOPIC,
      RP1_COMPLEXES_TOPIC,
      RP1_BUILD_QUEUE_TOPIC,
      RP1_WAREHOUSE_TOPIC,
      RP1_PADS_TOPIC,
      RP1_OPERATIONS_TOPIC,
      RP1_RESEARCH_TOPIC,
      RP1_PERSONNEL_TOPIC,
      RP1_CONFIDENCE_TOPIC,
      RP1_PROGRAMS_TOPIC,
      RP1_PROGRAM_SLOTS_TOPIC,
    ]) {
      expect(isTopicId(topic)).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });
});

describe("decode-time unit hydration", () => {
  // The runtime half of owning our own contract slice. Without the
  // registerTopicUnits loop in topics.ts these fields arrive as bare numbers
  // while ./__generated__/contract.ts still types them Value<"bp">, and nothing
  // else in the tree would notice.
  it('hydrates the build queue into Value<"bp"> and Value<"bp/s">', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_BUILD_QUEUE_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_BUILD_QUEUE_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_BUILD_QUEUE_TOPIC, [
      {
        kscName: "Cape",
        lcId: "lc-1",
        shipName: "Vanguard",
        progress: 200,
        totalPoints: 1000,
        progressRatio: 0.2,
        rate: 2,
        timeLeftSeconds: 400,
        stalled: false,
        cost: 5000,
        mass: 3,
        humanRated: false,
        launchSite: "LaunchPad",
        projectType: "VAB",
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.progress).toBeDefined();
    });

    const row = result.current?.[0];
    // A plain number has no own `magnitude`/`unit`, so these are the
    // non-vacuous proof the field decoded through the unit registry.
    expect(row?.progress).toMatchObject({ magnitude: 200, unit: "bp" });
    expect(row?.totalPoints).toMatchObject({ magnitude: 1000, unit: "bp" });
    expect(row?.rate).toMatchObject({ magnitude: 2, unit: "bp/s" });
    expect(row?.timeLeftSeconds).toMatchObject({ magnitude: 400, unit: "s" });
    expect(row?.cost).toMatchObject({ magnitude: 5000, unit: "funds" });
    // Flag is a non-quantity token: a bare boolean, never wrapped.
    expect(row?.stalled).toBe(false);
    // So is an id or a piece of text.
    expect(row?.shipName).toBe("Vanguard");
    expect(row?.projectType).toBe("VAB");
  });

  it('hydrates confidence into Value<"confidence">, including a real zero', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_CONFIDENCE_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_CONFIDENCE_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_CONFIDENCE_TOPIC, { confidence: 0, earned: 240 });

    await waitFor(() => {
      expect(result.current?.earned).toBeDefined();
    });

    // A career that has spent everything reads zero, and that is a reading. It
    // has to survive the decode as one rather than falling out as an absence.
    expect(result.current?.confidence).toMatchObject({
      magnitude: 0,
      unit: "confidence",
    });
    expect(result.current?.earned).toMatchObject({
      magnitude: 240,
      unit: "confidence",
    });
  });

  it("carries an absent rate through as absent rather than as a zero", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_BUILD_QUEUE_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_BUILD_QUEUE_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_BUILD_QUEUE_TOPIC, [
      {
        kscName: "Cape",
        lcId: "lc-1",
        shipName: "Sputnik",
        progress: 0,
        totalPoints: 1000,
        progressRatio: 0,
        rate: null,
        timeLeftSeconds: null,
        stalled: false,
        cost: 0,
        mass: 0,
        humanRated: false,
        launchSite: "LaunchPad",
        projectType: "VAB",
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.shipName).toBe("Sputnik");
    });

    const row = result.current?.[0];
    // The distinction the whole payload rests on: not costed yet, versus
    // costed and going nowhere. A wrapped zero here would erase it.
    expect(row?.rate ?? null).toBeNull();
    expect(row?.timeLeftSeconds ?? null).toBeNull();
    expect(row?.stalled).toBe(false);
    // A present zero on the same row still wraps, which is what makes the
    // absence above meaningful rather than incidental.
    expect(row?.progress).toMatchObject({ magnitude: 0, unit: "bp" });
  });
});

describe("the programs channel", () => {
  it("hydrates the money and the dates, and leaves state and speed bare", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_PROGRAMS_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_PROGRAMS_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_PROGRAMS_TOPIC, [
      {
        name: "EarlyXPlanes",
        title: "X-Plane Research",
        state: "active",
        speed: "Normal",
        slots: 2,
        isHumanSpaceflight: true,
        nominalDurationSeconds: 283_1184_00,
        acceptedUt: 1000,
        deadlineUt: 284_1184_00,
        objectivesCompletedUt: null,
        completedUt: null,
        lastPaymentUt: 5000,
        fracElapsed: 0.25,
        totalFunding: 800_000,
        fundsPaidOut: 120_000,
        fundsRemaining: 680_000,
        fundingCurve: "BimodalBackloaded",
        confidenceCost: 350,
        repDeltaOnCompletePerYearEarly: 130,
        repPenaltyPerYearLate: 130,
        repPenaltyAssessed: 0,
        requirementsMet: true,
        objectivesMet: false,
        canAccept: false,
        canComplete: false,
        requirementsText: null,
        objectivesText: "Complete X-Planes contracts.",
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.name).toBe("EarlyXPlanes");
    });

    const row = result.current?.[0];
    expect(row?.totalFunding).toMatchObject({
      magnitude: 800_000,
      unit: "funds",
    });
    expect(row?.confidenceCost).toMatchObject({
      magnitude: 350,
      unit: "confidence",
    });
    expect(row?.repPenaltyPerYearLate).toMatchObject({
      magnitude: 130,
      unit: "rep",
    });
    expect(row?.deadlineUt).toMatchObject({
      magnitude: 284_1184_00,
      unit: "ut",
    });
    expect(row?.fracElapsed).toMatchObject({ magnitude: 0.25, unit: "ratio" });
    // An interval, so seconds, against the instants above: a Program's duration
    // is not a date and must not decode as one.
    expect(row?.nominalDurationSeconds).toMatchObject({
      magnitude: 283_1184_00,
      unit: "s",
    });
    // Enumerations and text are non-quantity tokens: bare, never wrapped.
    expect(row?.state).toBe("active");
    expect(row?.speed).toBe("Normal");
    expect(row?.fundingCurve).toBe("BimodalBackloaded");
    // A Program inside its deadline has genuinely lost nothing, and that zero
    // is a reading rather than an absence.
    expect(row?.repPenaltyAssessed).toMatchObject({
      magnitude: 0,
      unit: "rep",
    });
    // An offer that has never paid is absent here rather than zero.
    expect(row?.objectivesCompletedUt ?? null).toBeNull();
  });

  it("carries the offer's absences through as absences", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_PROGRAMS_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_PROGRAMS_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_PROGRAMS_TOPIC, [
      {
        name: "CrewedOrbit",
        title: "Crewed Orbit",
        state: "locked",
        speed: "Normal",
        slots: 3,
        isHumanSpaceflight: true,
        nominalDurationSeconds: 189_3456_00,
        acceptedUt: null,
        deadlineUt: null,
        objectivesCompletedUt: null,
        completedUt: null,
        lastPaymentUt: null,
        fracElapsed: null,
        totalFunding: 2_000_000,
        fundsPaidOut: null,
        fundsRemaining: null,
        fundingCurve: "Flat",
        confidenceCost: 600,
        repDeltaOnCompletePerYearEarly: 200,
        repPenaltyPerYearLate: 200,
        repPenaltyAssessed: null,
        requirementsMet: false,
        objectivesMet: false,
        canAccept: false,
        canComplete: false,
        requirementsText: "Complete the Early Satellites program.",
        objectivesText: "Put a crew in orbit and recover them.",
      },
    ]);

    await waitFor(() => {
      expect(result.current?.[0]?.name).toBe("CrewedOrbit");
    });

    const row = result.current?.[0];
    // Money that MIGHT be earned is not money outstanding: an offer's total is
    // present and its paid-out and remaining are not, which is the distinction
    // a "0 of 2,000,000 paid" readout would erase.
    expect(row?.totalFunding).toMatchObject({
      magnitude: 2_000_000,
      unit: "funds",
    });
    expect(row?.fundsPaidOut ?? null).toBeNull();
    expect(row?.fundsRemaining ?? null).toBeNull();
    expect(row?.acceptedUt ?? null).toBeNull();
    expect(row?.deadlineUt ?? null).toBeNull();
    expect(row?.fracElapsed ?? null).toBeNull();
    expect(row?.repPenaltyAssessed ?? null).toBeNull();
  });

  it("hydrates the slot ceiling and keeps a real zero of free slots", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [RP1_PROGRAM_SLOTS_TOPIC],
    });
    const { result } = renderHook(
      () => judgeable(useTelemetry(RP1_PROGRAM_SLOTS_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(RP1_PROGRAM_SLOTS_TOPIC, {
      maxSlots: 3,
      usedSlots: 3,
      freeSlots: 0,
      activeCount: 2,
      completedCount: 4,
    });

    await waitFor(() => {
      expect(result.current?.maxSlots).toBeDefined();
    });

    expect(result.current?.maxSlots).toMatchObject({
      magnitude: 3,
      unit: "count",
    });
    // Full is a reading, and it is the one that decides whether an operator can
    // start anything. It has to survive the decode as a zero.
    expect(result.current?.freeSlots).toMatchObject({
      magnitude: 0,
      unit: "count",
    });
    expect(result.current?.completedCount).toMatchObject({
      magnitude: 4,
      unit: "count",
    });
  });
});
