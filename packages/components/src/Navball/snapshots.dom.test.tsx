/**
 * Widget-level DOM snapshots — complements the dial-only SVG snapshot
 * in `snapshots.test.ts` by covering the full Navball widget (header,
 * mode badges, dial, throttle column, control surface) across every
 * registered mode. The matching PNG renders live in
 * `local_docs/renders/navball-widget/`.
 *
 * Every value read is off the stream now (vessel.attitude / vessel.control /
 * the derived vessel.state / comms.delay), so these render through a real
 * `TelemetryProvider` via `setupStreamFixture` — the shared legacy
 * `MockDataSource` `snapshotWidgetMode` harness no longer feeds a stream-only
 * widget. The legacy fixtures' keys are reshaped onto the wire topics before
 * emitting.
 *
 * Re-seed with `vitest run -u src/Navball/snapshots.dom.test`.
 */
import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";

import { act, render } from "@ksp-gonogo/test-utils";
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
import banked from "./__fixtures__/banked-90-right.json";
import gravityTurn from "./__fixtures__/gravity-turn-east.json";
import inverted from "./__fixtures__/inverted-level.json";
import launchpad from "./__fixtures__/launchpad-vertical.json";
import maneuver from "./__fixtures__/maneuver-burn.json";
import north from "./__fixtures__/north-level.json";
import progradeLevel from "./__fixtures__/prograde-east-level.json";
import steepDive from "./__fixtures__/steep-dive-west.json";
import uncontrollable from "./__fixtures__/uncontrollable-drift.json";
import { NavballComponent } from "./index";

const FIXTURES = {
  "launchpad-vertical": launchpad,
  "prograde-east-level": progradeLevel,
  "gravity-turn-east": gravityTurn,
  "banked-90-right": banked,
  "inverted-level": inverted,
  "steep-dive-west": steepDive,
  "maneuver-burn": maneuver,
  "uncontrollable-drift": uncontrollable,
  "north-level": north,
};

// SAS-mode string → contract SasMode ordinal (mirrors the widget's SAS_MODES
// order and vessel-state's SAS_MODE_NAMES so the derived sasModeName
// round-trips).
const SAS_MODE_ORDINAL: Record<string, number> = {
  StabilityAssist: 0,
  Prograde: 1,
  Retrograde: 2,
  Normal: 3,
  Antinormal: 4,
  RadialIn: 5,
  RadialOut: 6,
  Target: 7,
  AntiTarget: 8,
  Maneuver: 9,
};

type Fixture = Record<string, unknown>;

function num(f: Fixture, key: string): number {
  const v = f[key];
  return typeof v === "number" ? v : 0;
}

function emitFixture(fixture: StreamFixture, f: Fixture): void {
  act(() => {
    // vessel.orbit (Loaded) + vessel.flight gate the vessel.state record so
    // sasModeName / isControllable resolve.
    fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
    fixture.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      surfaceSpeed: 0,
      verticalSpeed: 0,
    });
    fixture.emit("vessel.attitude", {
      heading: num(f, "n.heading"),
      pitch: num(f, "n.pitch"),
      roll: num(f, "n.roll"),
      headingRootFrame: num(f, "n.heading2"),
      pitchRootFrame: num(f, "n.pitch2"),
      rollRootFrame: num(f, "n.roll2"),
    });
    const sasModeName =
      typeof f["f.sasMode"] === "string" ? (f["f.sasMode"] as string) : "";
    fixture.emit("vessel.control", {
      sas: f["f.sasEnabled"] === true,
      sasMode: SAS_MODE_ORDINAL[sasModeName] ?? 0,
      rcs: f["v.rcsValue"] === true,
      precisionControl: f["f.precisionControl"] === true,
      throttle: num(f, "f.throttle"),
    });
    // isControllable !== false in the fixture → controllable (ControlState.Full);
    // an explicit false → ControlState.None.
    fixture.emit("vessel.comms", {
      controlState: f["v.isControllable"] === false ? 0 : 4,
    });
    if (typeof f["comm.signalDelay"] === "number") {
      fixture.emit("comms.delay", { oneWaySeconds: f["comm.signalDelay"] });
    }
  });
}

async function snapshotNavball(
  f: Fixture,
  mode: WidgetSnapshotMode,
): Promise<string> {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "vessel.attitude",
      "vessel.control",
      "vessel.orbit",
      "vessel.flight",
      "vessel.comms",
      "comms.delay",
    ],
    pinnedUt: 10,
  });
  const config = {
    ...(mode.config ?? {}),
  } as Parameters<typeof NavballComponent>[0]["config"];
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <NavballComponent config={config} id="snap" w={mode.w} h={mode.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  emitFixture(fixture, f);
  // The stream ingest only reaches React state via the provider's beginFrame
  // (a requestAnimationFrame, microtask fallback under jsdom). Flush two rAF
  // ticks inside act so the re-render commits before capture.
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const html = stripVolatile(container.innerHTML);
  unmount();
  return html;
}

const config = getWidget("navball");
if (!config) throw new Error("navball missing from widgets.ts");

describe("Navball widget DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotNavball(fixture as Fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
