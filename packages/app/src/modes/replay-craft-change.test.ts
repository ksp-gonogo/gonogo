import { buildModeLayer, recordedModeFrames } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import crashfall from "../../../components/src/LandingStatus/__fixtures__/rig/landing-crashfall.replay.json";

/*
 * A real recording from the rig in which the active craft changes: a lander
 * falls to a crash on the Mun, and what is left after it is another craft with
 * another id. A store that holds the whole flight has heard every one of them.
 */
describe("a replay of a flight whose active craft changes", () => {
  const overlay = buildModeLayer({
    mode: "replay",
    entry: 1,
    modelled: false,
    frames: recordedModeFrames("replay", crashfall.frames),
  });
  if (!overlay) throw new Error("the recording built no store");
  const craftAt = (ut: number): string | undefined => {
    overlay.store.clock.scrubTo(ut);
    overlay.store.beginFrame();
    const reading = overlay.store.sampleReading<{
      meta?: { source?: string };
    }>("vessel.orbit");
    return reading.state === "observed"
      ? reading.value.meta?.source
      : reading.state;
  };

  it("shows the craft that was flying at each moment, not only the last one the flight had", () => {
    const during = craftAt(3452);
    const after = craftAt(3502);
    expect(during).toMatch(/^vessel:/);
    expect(after).toMatch(/^vessel:/);
    // Before the crash and after it are different craft, and each is shown in its own time.
    expect(during).not.toBe(after);
    expect(craftAt(3262)).toMatch(/^vessel:/);
  });
});
