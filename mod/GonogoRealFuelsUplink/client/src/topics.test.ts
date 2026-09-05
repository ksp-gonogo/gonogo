import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
// Side-effect import: registers this Uplink's three Topics into the SDK's
// runtime registry and feeds its generated unit/shape maps into BOTH halves of
// the relocated unit registry.
import {
  REALFUELS_AVAILABLE_TOPIC,
  REALFUELS_BOILOFF_TOPIC,
  REALFUELS_ENGINES_TOPIC,
} from "./topics";

// src -> client -> GonogoRealFuelsUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in RealFuelsUplink.cs, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "RealFuelsUplink.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in RealFuelsUplink.cs`);
  }
  return m[1];
}

describe("the three RealFuels Topics", () => {
  it.each([
    ["AvailableTopic", REALFUELS_AVAILABLE_TOPIC],
    ["EnginesTopic", REALFUELS_ENGINES_TOPIC],
    ["BoiloffTopic", REALFUELS_BOILOFF_TOPIC],
  ])("%s registers the same string the C# Uplink declares", (_name, topic) => {
    expect(topic).toBe(csTopic(_name));
  });

  // They are runtime registrations from this client rather than static members
  // of the SDK's own union, so this assertion is what stands between the
  // relocation and `isTopicId("realfuels.engines")` silently going false for
  // every consumer, the replay recorder included.
  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [
      REALFUELS_AVAILABLE_TOPIC,
      REALFUELS_ENGINES_TOPIC,
      REALFUELS_BOILOFF_TOPIC,
    ]) {
      expect(isTopicId(topic), `${topic} is not a known TopicId`).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });
});

// The relocated unit registry, proved by DECODE rather than by reading the
// registry back. Non-vacuous by construction: delete either loop in topics.ts
// and one of the two describes below fails with a bare number.
describe("unit hydration at decode time", () => {
  it('hydrates the boiloff rate into a Value<"kg/s">', async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALFUELS_BOILOFF_TOPIC],
    });
    /**
     * The hook returns the PAYLOAD rather than the reading: a `Reading` is
     * always defined, so a `waitFor` on the reading itself passes on the first
     * tick and every hydration assertion below would then read `undefined` off
     * the wrapper.
     */
    const { result } = renderHook(
      () => {
        const reading = useTelemetry(REALFUELS_BOILOFF_TOPIC);
        return reading.state === "observed" ? reading.value : undefined;
      },
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALFUELS_BOILOFF_TOPIC, {
      boiloffRate: 0.31,
      cryogenicTankCount: 2,
    });

    await waitFor(() => {
      expect(result.current?.boiloffRate).toBeDefined();
    });
    expect(result.current?.boiloffRate).toMatchObject({
      magnitude: 0.31,
      unit: "kg/s",
    });
  });

  /**
   * The half `registerTopicUnits` alone cannot reach. Every unit an operator
   * reads on the engines channel sits on the NESTED per-engine rows, which
   * `wrapTopicPayload` only reaches by resolving the `engines` field's shape to
   * `RealFuelsEngineEntry` and looking that type up BY NAME. Without the
   * `registerTypeUnits` loop the stability arrives as a bare number while the
   * generated contract still types it Value<"ratio">.
   */
  it("hydrates units on the nested engine rows, not just the payload's own fields", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [REALFUELS_ENGINES_TOPIC],
    });
    const { result } = renderHook(
      () => {
        const reading = useTelemetry(REALFUELS_ENGINES_TOPIC);
        return reading.state === "observed" ? reading.value : undefined;
      },
      { wrapper: fixture.Provider },
    );

    fixture.emit(REALFUELS_ENGINES_TOPIC, {
      ignitionsLimited: true,
      ullageSimulated: true,
      engines: [
        {
          partName: "RD-58",
          ignitionsRemaining: 2,
          ullageStability: 0.82,
          ratedBurnTimeSeconds: 680,
          groundIgnitionOnly: false,
        },
      ],
    });

    await waitFor(() => {
      expect(result.current?.engines?.[0]).toBeDefined();
    });
    const engine = result.current?.engines?.[0];
    expect(engine?.ullageStability).toMatchObject({
      magnitude: 0.82,
      unit: "ratio",
    });
    expect(engine?.ratedBurnTimeSeconds).toMatchObject({
      magnitude: 680,
      unit: "s",
    });
    // Units.Flag and Units.Text are non-quantity tokens, so both stay bare: the
    // contrast that ties the wrapping to the TOKEN rather than to "this field
    // was annotated".
    expect(engine?.groundIgnitionOnly).toBe(false);
    expect(engine?.partName).toBe("RD-58");
  });
});
