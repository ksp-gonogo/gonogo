import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * Characterisation of what CurrentOrbit DOES today when its telemetry reads
 * are `undefined`. Not what it should do.
 *
 * Every row of this widget is its own absence gate (`x === undefined ?
 * NULL_DISPLAY : <Unit .../>`), plus three structural ones:
 *
 *   - `hasOrbit = sma != null && eccentricity != null && periapsisR != null`
 *     gates the mini diagram, which then reads `sma.magnitude` unguarded
 *   - `refBody !== undefined` gates the reference-body caption
 *   - the Pe row's accent comes from `periapsisA !== undefined && periapsisA
 *     < 0`, so absence decides a COLOUR as well as a glyph
 *
 * A dash on screen therefore has two possible authors, and the tests below
 * distinguish them structurally because the migration will treat them
 * differently: the WIDGET's gate renders `NULL_DISPLAY` as a direct text
 * child of the value span, while ui-kit's `Unit` renders its own inner span
 * around it (`Countdown` returns the bare glyph, so it reads as the former).
 * Where the dash comes from `Unit`, the widget's gate has already failed open
 * and the renderer is what caught it.
 *
 * Reads ride the real `TelemetryProvider`/`TimelineStore` pipeline via
 * `setupStreamFixture`, so "nothing arrived" here is a genuinely subscribed,
 * genuinely empty store rather than a stubbed hook.
 */

registerStockBodies();

/** All eight `vessel.state` inputs, as `CurrentOrbit/stream.test.tsx` carries them. */
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
] as const;

const KERBIN_MU = 3.5316e12;
const KERBIN_RADIUS = 600000;

function renderCurrentOrbit(size: { w: number; h: number }) {
  const fixture = setupStreamFixture({
    carriedChannels: [...VESSEL_STATE_INPUTS],
    pinnedUt: 0,
    suspendFrames: true,
  });
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "orbit-undef" }}>
        <CurrentOrbitComponent id="orbit-undef" w={size.w} h={size.h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { container, fixture };
}

interface OrbitEmission {
  sma: number;
  ecc: number;
  inc?: number;
  /** Also emit `vessel.identity` + `system.bodies`, which the apsis ALTITUDES and the body caption need. */
  withBody?: boolean;
}

function emitOrbit(fixture: StreamFixture, o: OrbitEmission) {
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 0,
        sma: o.sma,
        ecc: o.ecc,
        inc: o.inc ?? 0.3,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: KERBIN_MU,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      { quality: Quality.OnRails },
    );
    if (o.withBody) {
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Test Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 0,
        launchUt: 0,
      });
      fixture.emit("system.bodies", {
        bodies: [{ index: 0, name: "Kerbin", radius: KERBIN_RADIUS }],
      });
    }
  });
}

/** The value span beside a row label (the Grid lays them out label-then-value). */
function valueFor(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) {
    throw new Error(`no value span beside the ${label} label`);
  }
  return value;
}

describe("CurrentOrbit: nothing has arrived at all", () => {
  it("dashes every visible row, draws no diagram, and shows no reference body", () => {
    const { container } = renderCurrentOrbit({ w: 9, h: 18 });

    // Seven value rows are visible at this size and every one takes its
    // `=== undefined` arm. An exact count, not `>=`: a gate that stops firing
    // swaps a dash for a rendered value, and only counting notices.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(7);
    // Labels are unconditional, so the widget is fully laid out and only the
    // values are missing.
    expect(visibleText(container)).toBe(
      `ORBITAp${NULL_DISPLAY}Pe${NULL_DISPLAY}Inc${NULL_DISPLAY}t-Ap${NULL_DISPLAY}t-Pe${NULL_DISPLAY}Ecc${NULL_DISPLAY}T${NULL_DISPLAY}`,
    );
    // Each dash is the WIDGET's own gate firing, not `Unit` formatting an
    // absent magnitude: direct text, no inner span. Contrast the null
    // (tombstone) case further down, where Ap's gate misses and `Unit` is
    // what produces the glyph.
    expect(valueFor("Ap").firstElementChild).toBeNull();
    expect(valueFor("t-Ap").firstElementChild).toBeNull();
    // `hasOrbit` fires, so the diagram slot never mounts. That matters more
    // than the dashes: the diagram reads `sma.magnitude` and
    // `eccentricity.magnitude` with no optional chaining, so this gate is the
    // only thing between an absent orbit and a throw.
    expect(container.querySelector("svg")).toBeNull();
    // `refBody !== undefined` suppresses the caption outright: no dash, no
    // "unknown body", nothing.
    expect(visibleText(container)).not.toContain("Kerbin");
  });

  it("keeps the Pe row on its normal accent rather than the impact-alert one", () => {
    renderCurrentOrbit({ w: 9, h: 18 });

    // `periapsisA !== undefined && periapsisA < 0` promotes Pe to the nogo
    // alert colour ("the vessel will hit terrain"). Absence takes the safe
    // side today: the dash is painted plain Pe blue. After the migration the
    // `!== undefined` half stops filtering and `< 0` is asked of an object.
    expect(valueFor("Pe").style.color).toBe("var(--color-tag-blue-fg)");
  });

  it("drops the supplementary rows by height, and dashes the two that remain", () => {
    const { container } = renderCurrentOrbit({ w: 3, h: 4 });

    // At the 3x4 minSize only Ap and Pe render at all, so an absent ROW and
    // an absent VALUE are different things: this pins which is which.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(2);
    expect(visibleText(container)).toBe(
      `ORBITAp${NULL_DISPLAY}Pe${NULL_DISPLAY}`,
    );
  });
});

describe("CurrentOrbit: a partial payload, the orbit without its body", () => {
  it("renders Inc/Ecc/T but dashes Ap/Pe, whose altitudes need the body radius", async () => {
    const { container, fixture } = renderCurrentOrbit({ w: 9, h: 18 });
    emitOrbit(fixture, { sma: 682500, ecc: 0.00367, inc: 0.3 });

    await waitFor(() => expect(visibleText(container)).toContain("0.3°"));
    // `vessel.orbit` has landed so the raw elements render, but
    // `apoapsisAlt`/`periapsisAlt` stay `undefined` until `system.bodies`
    // supplies a radius. Five rows carry values and the two HEADLINE rows
    // dash, with nothing to say that those two are the absent ones.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(2);
    expect(valueFor("Ap").textContent).toBe(NULL_DISPLAY);
    expect(valueFor("Pe").textContent).toBe(NULL_DISPLAY);
    // The diagram DOES mount: `hasOrbit` reads the apsis RADII, which come
    // straight off the elements and need no body.
    expect(container.querySelector("svg")).not.toBeNull();
    // No reference-body caption: `referenceBodyName` is an index → name
    // resolution against `system.bodies`, absent here.
    expect(visibleText(container)).not.toContain("Kerbin");
  });
});

describe("CurrentOrbit: null (inapplicable) versus undefined (nothing yet)", () => {
  it("lets a null Ap and a null t-Ap through their gates, and ui-kit renders the dash", async () => {
    const { container, fixture } = renderCurrentOrbit({ w: 9, h: 18 });
    // A hyperbolic escape (ecc >= 1, sma < 0). `deriveVesselState`'s
    // elliptical solver degrades rather than throwing, so
    // apoapsisAlt/apoapsisRadius/timeToAp/timeToPe/period all arrive as
    // `null` ("confirmed inapplicable") while periapsis stays real.
    emitOrbit(fixture, { sma: -2000000, ecc: 1.35, withBody: true });

    await waitFor(() => expect(visibleText(container)).toContain("Kerbin"));

    // Four dashes: Ap, t-Ap, t-Pe, T. Pe/Inc/Ecc carry real values.
    expect(visibleText(container)).toBe(
      `ORBITKerbinorbit planeAp${NULL_DISPLAY}Pe100.0 kmInc0.3°t-Ap${NULL_DISPLAY}t-Pe${NULL_DISPLAY}Ecc1.3500T${NULL_DISPLAY}`,
    );

    // Ap's gate is `apoapsisA === undefined`, which a `null` does not
    // satisfy, and the widget's `hyperbolic` second chance is dead code:
    // `typeof eccentricity === "number"` is false because `vessel.orbit.ecc`
    // decodes to a `Value` object ({magnitude: 1.35, unit: "1"}), so
    // `hyperbolic` is ALWAYS false here. The null reaches `<Unit value=
    // {value("m", null)} />`, which renders NULL_DISPLAY inside its own span:
    // that inner element is the proof the widget's gate missed.
    expect(valueFor("Ap").firstElementChild?.textContent).toBe(NULL_DISPLAY);

    // t-Ap's gate (`timeToAp === undefined || hyperbolic`) misses the null
    // for both the same reasons; `<Countdown value={null} />` returns the
    // bare glyph, so this dash looks like a gate hit but is not one.
    expect(valueFor("t-Ap").textContent).toBe(NULL_DISPLAY);

    // t-Pe is the one row that names `null` explicitly (`timeToPe ===
    // undefined || timeToPe === null`), so its dash IS the widget's own gate.
    expect(valueFor("t-Pe").firstElementChild).toBeNull();

    // T folds the tombstone into nothing-arrived (`period = vesselState
    // ?.period ?? undefined`), so the widget cannot distinguish "this
    // trajectory has no period" from "no frame has arrived": both dash, from
    // the same gate.
    expect(valueFor("T").firstElementChild).toBeNull();

    // `hasOrbit` still passes (periapsisRadius is real), so the diagram draws
    // a hyperbolic trajectory off `apoapsis={apoapsisR ?? 0}`.
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
