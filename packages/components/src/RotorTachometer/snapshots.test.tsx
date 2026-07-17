import { DashboardItemContext } from "@ksp-gonogo/core";

import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import rotors from "./__fixtures__/rotors.json";
import unavailable from "./__fixtures__/unavailable.json";
import { RotorTachometerComponent } from "./index";

/**
 * DOM-snapshot regression tests for RotorTachometer.
 *
 * `index.tsx` reads `parts.robotics`/`robotics.available` canonically off the
 * stream (`useTelemetry`), with NO legacy fallback — so the shared
 * `snapshotWidgetMode` helper (which feeds a legacy `MockDataSource`) can't
 * reach it. This file builds its own per-fixture stream render instead,
 * emitting the fixture's `parts.robotics` array verbatim and its bare
 * `robotics.available` boolean reshaped onto the wire `{ available }` record.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/RotorTachometer/snapshots -u`.
 */
interface RotorFixture {
  "robotics.available": boolean;
  "parts.robotics": unknown[];
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
    carriedChannels: ["parts.robotics", "robotics.available"],
    pinnedUt: 10,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <RotorTachometerComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  act(() => {
    streamFixture.emit("robotics.available", {
      available: fixture["robotics.available"],
    });
    streamFixture.emit("parts.robotics", fixture["parts.robotics"]);
  });

  await waitFor(() => {
    const point = streamFixture.store.sample(
      "parts.robotics",
      streamFixture.store.currentFrame(),
    );
    if (point?.payload === undefined) {
      throw new Error("parts.robotics has not resolved off the stream yet");
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
