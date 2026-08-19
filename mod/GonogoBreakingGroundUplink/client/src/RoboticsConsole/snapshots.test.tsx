import {
  act,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/sitrep-testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
import servos from "./__fixtures__/servos.json";
import unavailable from "./__fixtures__/unavailable.json";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

/**
 * DOM-snapshot regression tests for RoboticsConsole.
 *
 * `index.tsx` reads `robotics.servos`/`robotics.available` canonically off the
 * stream (`useTelemetry`), with NO legacy fallback: so the shared
 * `snapshotWidgetMode` helper (which feeds a legacy `MockDataSource`) can't
 * reach it. This file builds its own per-fixture stream render instead,
 * emitting the fixture's `robotics.servos` array verbatim and its bare
 * `robotics.available` boolean reshaped onto the wire `{ available }` record.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/RoboticsConsole/snapshots -u`.
 */
interface RoboticsFixture {
  "robotics.available": boolean;
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
    carriedChannels: ["robotics.servos", "robotics.available"],
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
    streamFixture.emit("robotics.available", {
      available: fixture["robotics.available"],
    });
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
