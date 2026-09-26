import {
  act,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import unavailable from "./__fixtures__/robotics-dlc-absent.json";
import servos from "./__fixtures__/servos.json";
// Side-effect import: the widget self-registers on module load.
import "./index";

/**
 * DOM snapshots of RoboticsConsole off the stream, one per fixture; the bare `robotics.available` boolean is reshaped onto the wire `{ available }` record.
 * Regenerate an intended change with `pnpm --filter @ksp-gonogo/components exec vitest run src/RoboticsConsole/snapshots -u`.
 */
/** Without the expansion the Uplink never emits `robotics.available`, so the DLC-absent scenes carry `game.dlc` instead. */
interface RoboticsFixture {
  "robotics.available"?: boolean;
  "game.dlc"?: { breakingGround: boolean; makingHistory: boolean };
  "robotics.servos": unknown[];
  [key: string]: unknown;
}

const FIXTURES: Record<string, RoboticsFixture> = {
  servos: servos as RoboticsFixture,
  unavailable: unavailable as RoboticsFixture,
};

const config = getWidget("robotics-console");
if (!config) throw new Error("robotics-console missing from widgets.ts");

async function snapshotStream(
  fixture: RoboticsFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["robotics.servos", "robotics.available", "game.dlc"],
    pinnedUt: 10,
  });

  const { container } = renderWidget("robotics-console", {
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

describe("RoboticsConsole DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
