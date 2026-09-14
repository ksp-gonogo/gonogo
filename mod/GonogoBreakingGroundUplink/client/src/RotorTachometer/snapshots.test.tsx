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
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

/**
 * DOM-snapshot regression tests for RotorTachometer.
 *
 * `index.tsx` reads `robotics.servos`/`robotics.available` canonically off the
 * stream (`useTelemetry`), with NO legacy fallback: so the shared
 * `snapshotWidgetMode` helper (which feeds a legacy `MockDataSource`) can't
 * reach it. This file builds its own per-fixture stream render instead,
 * emitting the fixture's `robotics.servos` array verbatim and its bare
 * `robotics.available` boolean reshaped onto the wire `{ available }` record.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/RotorTachometer/snapshots -u`.
 */
/**
 * A fixture may carry either presence fact, or neither. The DLC-absent scenes
 * withhold `robotics.available` on purpose, because without the expansion the
 * Uplink never emits on that channel at all, and carry `game.dlc` instead.
 */
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
    carriedChannels: ["robotics.servos", "robotics.available", "game.dlc"],
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
    /* Each presence fact is emitted only when the fixture carries it, so a
       scene that withholds one is rendered with it genuinely absent rather
       than with an `undefined` pushed onto the channel. */
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
