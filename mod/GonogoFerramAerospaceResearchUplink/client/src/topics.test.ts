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
// Side-effect import: registers both aero.* Topics and feeds this Uplink's own
// generated unit and shape maps into the decode-time registry.
import "./units";
import { AERO_AVAILABLE_TOPIC, AERO_STATE_TOPIC } from "./topics";

// src -> client -> GonogoFerramAerospaceResearchUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in the C# Uplink, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(
    join(UPLINK_ROOT, "FerramAerospaceResearchUplink.cs"),
    "utf8",
  );
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(
      `${constName} constant not found in FerramAerospaceResearchUplink.cs`,
    );
  }
  return m[1];
}

/**
 * A value only where one is current. What this Uplink is careful about is
 * absence, and a stale reading is a third thing again.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

describe("the aero.* Topic registrations", () => {
  it("register the same strings the C# Uplink declares", () => {
    // The two halves ship together and are versioned together, so a topic
    // renamed on one side and not the other is a rename nothing else catches.
    expect(AERO_AVAILABLE_TOPIC).toBe(csTopic("AvailableTopic"));
    expect(AERO_STATE_TOPIC).toBe(csTopic("StateTopic"));
  });

  it("are known TopicIds once this client's topics module has loaded", () => {
    for (const topic of [AERO_AVAILABLE_TOPIC, AERO_STATE_TOPIC]) {
      expect(isTopicId(topic)).toBe(true);
      expect(getAllKnownTopicIds()).toContain(topic);
    }
  });
});

describe("decode-time unit hydration", () => {
  it("hydrates every declared quantity, this Uplink's own two tokens included", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [AERO_STATE_TOPIC] });
    const { result } = renderHook(
      () => judgeable(useTelemetry(AERO_STATE_TOPIC)),
      { wrapper: fixture.Provider },
    );

    fixture.emit(AERO_STATE_TOPIC, {
      angleOfAttack: 4.5,
      sideslip: -0.25,
      stallFraction: 0.12,
      liftCoefficient: 0.42,
      dragCoefficient: 0.09,
      liftToDragRatio: 4.6,
      referenceArea: 18,
      liftForce: 61,
      dragForce: 13.2,
      indicatedAirspeed: 140,
      equivalentAirspeed: 138,
      terminalVelocity: 310,
      ballisticCoefficient: 420,
      specificExcessPower: 22,
      aeroModelValid: true,
    });

    await waitFor(() => {
      expect(result.current?.angleOfAttack).toBeDefined();
    });

    const s = result.current;
    // A plain number has no own `magnitude`/`unit`, so these are the
    // non-vacuous proof each field decoded through the unit registry.
    expect(s?.angleOfAttack).toMatchObject({ magnitude: 4.5, unit: "°" });
    expect(s?.stallFraction).toMatchObject({ magnitude: 0.12, unit: "ratio" });
    expect(s?.liftToDragRatio).toMatchObject({ magnitude: 4.6, unit: "1" });
    expect(s?.referenceArea).toMatchObject({ magnitude: 18, unit: "m²" });
    expect(s?.liftForce).toMatchObject({ magnitude: 61, unit: "kN" });
    expect(s?.indicatedAirspeed).toMatchObject({ magnitude: 140, unit: "m/s" });
    // The two tokens core has never heard of, and the reason ./units.ts
    // registers them on the MODEL seam as well as the display one: without a
    // model entry these arrive as bare numbers while the type says Value<>.
    expect(s?.ballisticCoefficient).toMatchObject({
      magnitude: 420,
      unit: "kg/m²",
    });
    expect(s?.specificExcessPower).toMatchObject({
      magnitude: 22,
      unit: "W/kg",
    });
    // Flag is a non-quantity token: a bare boolean, never wrapped.
    expect(s?.aeroModelValid).toBe(true);
  });

  it("carries the mod's absences through as absent rather than as zeros", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [AERO_STATE_TOPIC] });
    const { result } = renderHook(
      () => judgeable(useTelemetry(AERO_STATE_TOPIC)),
      { wrapper: fixture.Provider },
    );

    // What a launch vehicle on the pad actually publishes: no wings, so no
    // stall fraction; no airflow, so no attitude to it and no coefficients.
    fixture.emit(AERO_STATE_TOPIC, {
      angleOfAttack: null,
      sideslip: null,
      stallFraction: null,
      liftCoefficient: null,
      dragCoefficient: null,
      liftToDragRatio: null,
      referenceArea: 4.2,
      liftForce: 0,
      dragForce: 0,
      indicatedAirspeed: 0,
      equivalentAirspeed: null,
      terminalVelocity: null,
      ballisticCoefficient: null,
      specificExcessPower: 0,
      aeroModelValid: true,
    });

    await waitFor(() => {
      expect(result.current?.referenceArea).toBeDefined();
    });

    const s = result.current;
    expect(s?.stallFraction).toBeNull();
    expect(s?.angleOfAttack).toBeNull();
    expect(s?.ballisticCoefficient).toBeNull();
    // and the genuine zeros beside them survive the decode as readings, which
    // is the whole distinction the mod half is drawing.
    expect(s?.liftForce).toMatchObject({ magnitude: 0, unit: "kN" });
    expect(s?.indicatedAirspeed).toMatchObject({ magnitude: 0, unit: "m/s" });
  });
});
