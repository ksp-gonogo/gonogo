import { DashboardItemContext } from "@ksp-gonogo/core";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { act, render } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import {
  stripVolatile,
  type WidgetSnapshotMode,
} from "../test/widgetDomSnapshot";
import contractsOnly from "./__fixtures__/contracts-only.json";
import empty from "./__fixtures__/empty.json";
import { ObjectivesComponent } from "./index";

/**
 * Objectives DOM snapshots. `contracts.active` reads off
 * `career.status.contracts.active` now (no legacy fallback), so these render
 * through a real `TelemetryProvider` via `setupStreamFixture` rather than the
 * shared legacy `MockDataSource` `snapshotWidgetMode` harness. The fixtures'
 * legacy contract shape (`agency`/`repCompletion`/`deadlineUt`) is reshaped
 * onto the `career.status` wire shape before emitting.
 */
const FIXTURES = {
  "contracts-only": contractsOnly["contracts.active"],
  empty: empty["contracts.active"],
};

/** Reshape the legacy contract fixture entries onto the career.status wire shape. */
function toWireContracts(
  active: readonly Record<string, unknown>[],
): unknown[] {
  return active.map((c) => {
    const { agency, repCompletion, deadlineUt, ...rest } = c;
    return {
      ...rest,
      agent: agency,
      reputationCompletion: repCompletion,
      dateDeadline: deadlineUt,
    };
  });
}

function emitCareer(fixture: StreamFixture, active: readonly unknown[]): void {
  act(() => {
    fixture.emit("career.status", {
      economy: null,
      facilities: null,
      contracts: {
        active: toWireContracts(active as Record<string, unknown>[]),
        offered: [],
      },
      strategies: null,
      tech: null,
    });
  });
}

async function snapshotObjectives(
  active: readonly unknown[],
  mode: WidgetSnapshotMode,
): Promise<string> {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
  });
  const { container, unmount } = render(
    <ThemeProvider theme={defaultDarkTheme}>
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <ObjectivesComponent
            config={mode.config ?? {}}
            id="snap"
            w={mode.w}
            h={mode.h}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>
    </ThemeProvider>,
  );
  emitCareer(fixture, active);
  // The career.status ingest only reaches React state via the provider's
  // beginFrame (a requestAnimationFrame, microtask fallback under jsdom).
  // Flush two rAF ticks inside act so the re-render commits before capture.
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const html = stripVolatile(container.innerHTML);
  unmount();
  return html;
}

const config = getWidget("objectives");
if (!config) throw new Error("objectives missing from widgets.ts");

describe("Objectives DOM snapshots", () => {
  for (const [name, active] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotObjectives(active, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
