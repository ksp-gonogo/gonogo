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
