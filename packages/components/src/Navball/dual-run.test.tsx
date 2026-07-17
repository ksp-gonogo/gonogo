import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import northLevel from "./__fixtures__/north-level.json";
import { NavballComponent } from "./index";

/**
 * Navball's stream render golden. This began life as a legacy-`DataSource` ↔
 * stream byte-identical dual-run; every read now comes off the stream with no
 * legacy fallback — the attitude trio off `vessel.attitude.*`, SAS/RCS/
 * precision/throttle off `vessel.control`, and `sasMode`/`isControllable` off
 * the client-derived `vessel.state` channel (`sasModeName`/`isControllable`).
 * So the legacy leg is gone; what remains proves the same north-level
 * attitude/control state renders correctly off the real stream pipeline.
 *
 * `vessel.orbit` is emitted (Loaded quality) purely to gate the whole
 * `vessel.state` record so `sasModeName` (derived from `vessel.control.sasMode`)
 * resolves; without it the derived channel stays null and the SAS-mode caption
 * would never appear.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("Navball — stream render golden (delay=0)", () => {
  it("renders the north-level attitude/control state off the stream", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "vessel.attitude",
        "vessel.control",
        "vessel.orbit",
        "vessel.flight",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-dual" }}>
          <NavballComponent id="nav-dual" w={8} h={11} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      // Loaded quality drives deriveVesselState onto the measured basis, which
      // requires vessel.flight to be present for the record (and thus
      // sasModeName) to resolve.
      streamFixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      streamFixture.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        surfaceSpeed: 0,
        verticalSpeed: 0,
      });
      // The default config reads the root-part frame (*RootFrame); the base
      // CoM fields are emitted too so the payload matches the contract shape.
      streamFixture.emit("vessel.attitude", {
        heading: northLevel["n.heading"],
        pitch: northLevel["n.pitch"],
        roll: northLevel["n.roll"],
        headingRootFrame: northLevel["n.heading2"],
        pitchRootFrame: northLevel["n.pitch2"],
        rollRootFrame: northLevel["n.roll2"],
      });
      streamFixture.emit("vessel.control", {
        sas: northLevel["f.sasEnabled"],
        // Numeric SasMode enum (0 = StabilityAssist) — deriveVesselState maps
        // it to the "StabilityAssist" string the widget renders.
        sasMode: 0,
        rcs: northLevel["v.rcsValue"],
        precisionControl: northLevel["f.precisionControl"],
        throttle: northLevel["f.throttle"],
      });
    });

    // sasModeName resolves only off the derived vessel.state record, which is
    // fed purely by the stream here — so its presence proves the stream leg
    // landed (and the attitude readouts have left their "—" placeholder).
    await waitFor(() => {
      const attitudeResolved = !container.textContent?.includes("—");
      if (
        !attitudeResolved ||
        !container.textContent?.includes("StabilityAssist")
      ) {
        throw new Error("stream leg has not rendered the attitude state yet");
      }
    });
    expect(container.textContent).toContain("SAS: StabilityAssist");
  });
});
