import { DashboardItemContext } from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import servos from "./__fixtures__/servos.json";
import unavailable from "./__fixtures__/unavailable.json";
import { RoboticsConsoleComponent } from "./index";

/**
 * DOM-snapshot regression tests for RoboticsConsole.
 *
 * `index.tsx` reads `parts.robotics`/`robotics.available` canonically off the
 * stream (`useTelemetry`), with NO legacy fallback — so the shared
 * `snapshotWidgetMode` helper (which feeds a legacy `MockDataSource`) can't
 * reach it. This file builds its own per-fixture stream render instead,
 * emitting the fixture's `parts.robotics` array verbatim and its bare
 * `robotics.available` boolean reshaped onto the wire `{ available }` record.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/RoboticsConsole/snapshots -u`.
 */
interface RoboticsFixture {
  "robotics.available": boolean;
  "parts.robotics": unknown[];
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
    carriedChannels: ["parts.robotics", "robotics.available"],
    pinnedUt: 10,
  });

  const { container } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <RoboticsConsoleComponent
            config={mode.config ?? {}}
            id="snap"
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>
    </ThemeProvider>,
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
