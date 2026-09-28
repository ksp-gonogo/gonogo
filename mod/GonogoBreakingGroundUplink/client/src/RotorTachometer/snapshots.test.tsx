import {
  act,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import rotors from "./__fixtures__/rotors.json";
import unavailable from "./__fixtures__/rotors-dlc-absent.json";
// Side-effect import: the widget self-registers on module load.
import "./index";

/**
 * DOM snapshots of RotorTachometer off the stream, one per fixture; the bare `robotics.available` boolean is reshaped onto the wire `{ available }` record.
 * Regenerate an intended change with `pnpm --filter @ksp-gonogo/components exec vitest run src/RotorTachometer/snapshots -u`.
 */
/** Without the expansion the Uplink never emits `robotics.available`, so the DLC-absent scenes carry `game.dlc` instead. */
interface RotorFixture {
  "robotics.available"?: boolean;
  "game.dlc"?: { breakingGround: boolean; makingHistory: boolean };
  "robotics.servos": unknown[];
  [key: string]: unknown;
}

const FIXTURES: Record<string, RotorFixture> = {
  rotors: rotors as RotorFixture,
  unavailable: unavailable as RotorFixture,
};

const config = getWidget("rotor-tachometer");
if (!config) throw new Error("rotor-tachometer missing from widgets.ts");

async function snapshotStream(
  fixture: RotorFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    pinnedUt: 10,
  });

  const { container } = renderWidget("rotor-tachometer", {
    instanceId: "snap",
    config: mode.config ?? {},
    w: mode.w,
    h: mode.h,
    wrapper: streamFixture.Provider,
  });

  act(() => {
    // A presence fact the fixture withholds stays genuinely absent, never an emitted `undefined`.
    const availability = fixture["robotics.available"];
    if (availability !== undefined) {
      streamFixture.emit("robotics.available", { available: availability });
    }
    const dlc = fixture["game.dlc"];
    if (dlc !== undefined) streamFixture.emit("game.dlc", dlc);
    streamFixture.emit("robotics.servos", fixture["robotics.servos"]);
  });

  await waitFor(() => {
    const point = streamFixture.store.sample(
      "robotics.servos",
      streamFixture.store.currentFrame(),
    );
    if (point?.payload === undefined) {
      throw new Error("robotics.servos has not resolved off the stream yet");
    }
  });

  return stripVolatile(container.innerHTML);
}

describe("RotorTachometer DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
