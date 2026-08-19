import {
  clearActionHandlers,
  DashboardItemContext,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * What Navball DOES today when its telemetry reads are `undefined`, recorded
 * before `useTelemetry` becomes a `Reading`.
 *
 * `vessel.attitude` already reads as a `Reading` (see `reading.test.tsx`), so it
 * is out of scope here. What is left is every OTHER read in the widget, and each
 * one implements a different policy for absence:
 *
 *  - `control?.sas === true` / `rcs === true` / `precisionControl === true`
 *    coerce unknown to OFF for display, so an unread SAS looks exactly like a
 *    confirmed-off SAS
 *  - `magnitudeOr(control?.throttle, 0)` coerces unknown to a confident ZERO,
 *    which the throttle bar draws as an engine at idle
 *  - `if (typeof sasRaw !== "boolean") return` in `toggleSas`/`toggleRcs` is the
 *    one place absence is handled HONESTLY: the command is refused rather than
 *    guessed. It is also the highest-risk site in the file, because after the
 *    migration a `Reading` is always an object and `typeof` never says "boolean",
 *    so a naive port either always refuses or always guesses
 *  - `vesselState?.isControllable !== false` FAILS OPEN: unknown is treated as
 *    controllable, so the control surface is fully live with nothing on the wire
 *  - `delaySeconds !== null` gates the fly-by-wire delay warning, so an unread
 *    `comms.delay` arms FBW with no caveat at all
 *  - `activeVesselId` being `undefined` participates in the vessel-switch
 *    comparison, so the FIRST identity to arrive reads as a vessel CHANGE
 */

const CARRIED = [
  "vessel.attitude",
  "vessel.control",
  "vessel.identity",
  "vessel.state",
  "vessel.comms",
  "vessel.orbit",
  "comms.delay",
];

const ATTITUDE = {
  heading: 90,
  pitch: 45,
  roll: 0,
  headingRootFrame: 90,
  pitchRootFrame: 45,
  rollRootFrame: 0,
};

/** Kerbin-ish low orbit: only here to make `vessel.state` produce a record at all. */
const ORBIT = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

/** `Sitrep.Contract.ControlState.None`: collapses to level 0, i.e. NOT controllable. */
const CONTROL_STATE_NONE = 0;

let fixture: StreamFixture;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  // Navball registers ~30 actions per mount and this file mounts it many times
  // inside one rolling window of the `useActionInput register/sec` budget; the
  // established idiom for that (see command-stream.test.tsx, dual-run.test.tsx).
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
  fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 0 });
});

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
  clearActionHandlers();
});

function mount(
  instanceId: string,
  { w = 10, h = 12, controlMode = false } = {},
) {
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={{ controlMode }}
          id={instanceId}
          w={w}
          h={h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/** Commands this widget sent, by name. Excludes the control streams' own unconditional first-tick echoes. */
function sentNamed(command: string): unknown[] {
  return fixture.transport.sentCommands
    .filter((c) => c.command === command)
    .map((c) => c.args);
}

describe("Navball display: what undefined means today", () => {
  it("shows an unnamed SAS badge and both modes dark when nothing has arrived", () => {
    mount("nb-undef-nothing");

    // `sasMode = vesselState?.sasModeName ?? undefined`: absence renders the
    // bare word, so "SAS mode unknown" and "SAS mode not reported" look the same
    // as each other and are only distinguishable from a NAMED mode.
    expect(screen.getByText("SAS")).toBeInTheDocument();
    expect(visibleText()).not.toContain("SAS:");
    // `precisionOn = control?.precisionControl === true`: absence renders the
    // badge not at all, which is the same as a confirmed-off precision mode.
    expect(screen.queryByText("PRECISION")).toBeNull();
    // No FBW delay badge, since FBW is unarmed. Pinned so the delay-warning
    // tests below are about `delaySeconds`, not about this row being empty.
    expect(visibleText()).not.toContain("DELAY");
    // The throttle column rides `showDial`, so the coerced-to-zero throttle is
    // not on screen yet. Named-element absence, not an empty container.
    expect(screen.queryByText("THR")).toBeNull();
  });

  it("draws a confident zero-percent throttle when vessel.control never arrives", async () => {
    mount("nb-undef-throttle");

    act(() => {
      // Attitude only: enough to make the dial (and with it the throttle
      // column) render, with the control record still absent.
      fixture.emit("vessel.attitude", ATTITUDE);
    });

    // `magnitudeOr(control?.throttle, 0)`: absence becomes a real zero, and the
    // bar and readout state it as a measurement. There is no placeholder here
    // and no way to tell an idle engine from an unread one.
    await waitFor(() => expect(screen.getByText("THR")).toBeInTheDocument());
    expect(visibleText()).toContain("0 %");
  });

  it("coerces a missing throttle field to zero even when the control record itself arrived", async () => {
    mount("nb-undef-partial-control");

    act(() => {
      fixture.emit("vessel.attitude", ATTITUDE);
      // Partial payload: the record exists and says SAS is on, but carries no
      // throttle and no rcs. Distinct from the record being absent, and drawn
      // identically for the two fields it omits.
      fixture.emit("vessel.control", { sas: true });
    });

    // Proof the partial record landed, so the zero below is the coercion and
    // not a dropped emit.
    await waitFor(() =>
      expect(fixture.store.sample("vessel.control")?.payload).toEqual({
        sas: true,
      }),
    );
    expect(visibleText()).toContain("0 %");
  });
});

describe("Navball control surface: what undefined means today", () => {
  it("leaves the whole control surface live and unbannered when nothing has arrived", () => {
    mount("nb-undef-controls", { w: 10, h: 20, controlMode: true });

    // `isControllable = vesselState?.isControllable !== false` fails OPEN: with
    // no `vessel.comms` (so no derived `vessel.state` record at all) the widget
    // asserts the vessel IS controllable and enables every control.
    expect(
      screen.queryByText("Vessel not controllable: buttons disabled."),
    ).toBeNull();
    const sas = screen.getByRole("button", { name: "SAS OFF" });
    const rcs = screen.getByRole("button", { name: "RCS OFF" });
    expect(sas).not.toBeDisabled();
    expect(rcs).not.toBeDisabled();
    // Coerced-to-off display: an unread SAS button is labelled exactly as a
    // confirmed-off one.
    expect(screen.queryByRole("button", { name: "SAS ON" })).toBeNull();
    // And the slider states a commanded zero.
    expect(screen.getByRole("slider", { name: "Throttle" })).toHaveValue("0");
  });

  it("banners and disables the surface only on a CONFIRMED uncontrollable vessel", async () => {
    // The contrast case for the fail-open above. Without it the assertions there
    // could be read as "this widget never banners", rather than as absence being
    // routed into the controllable branch.
    mount("nb-undef-controls-confirmed", {
      w: 10,
      h: 20,
      controlMode: true,
    });

    act(() => {
      fixture.emit("vessel.orbit", ORBIT);
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_NONE });
    });

    await waitFor(() =>
      expect(
        screen.getByText("Vessel not controllable: buttons disabled."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "SAS OFF" })).toBeDisabled();
  });

  it("refuses to dispatch a SAS or RCS toggle when vessel.control has never arrived", async () => {
    mount("nb-undef-toggle-refused", { w: 10, h: 20, controlMode: true });

    act(() => {
      screen.getByRole("button", { name: "SAS OFF" }).click();
      screen.getByRole("button", { name: "RCS OFF" }).click();
      // A SAS-MODE click, which has no absence gate at all: its dispatch is the
      // control proving this render's command path is live, so the two empty
      // lists below are the gate firing rather than a fixture that cannot send.
      screen.getByRole("button", { name: "PRO" }).click();
    });

    await waitFor(() =>
      expect(sentNamed("vessel.control.setSasMode")).toEqual([{ mode: 1 }]),
    );

    // `if (typeof sasRaw !== "boolean") return`: the one honest absence gate in
    // the file. Inverting an unknown boolean would be a blind guess, so the
    // click is silently swallowed. This is the assertion most at risk in the
    // migration: a `Reading` is an object, so `typeof` alone can never again
    // answer this question.
    expect(sentNamed("vessel.control.setSas")).toEqual([]);
    expect(sentNamed("vessel.control.setRcs")).toEqual([]);
    // The button is not disabled, so the refusal is invisible to the operator:
    // it reads as a control that did nothing.
    expect(screen.getByRole("button", { name: "SAS OFF" })).not.toBeDisabled();
  });

  it("dispatches that same click once a real boolean has arrived", async () => {
    // Contrast case: proves the empty dispatch lists above are the gate firing,
    // not this test setup being unable to dispatch at all.
    mount("nb-undef-toggle-allowed", { w: 10, h: 20, controlMode: true });

    act(() => {
      fixture.emit("vessel.control", { sas: true, rcs: false, throttle: 0 });
    });
    // The label flipping to "SAS ON" is the proof the boolean reached the render,
    // which the never-arrived case cannot fake.
    const sas = await screen.findByRole("button", { name: "SAS ON" });

    act(() => {
      sas.click();
    });

    await waitFor(() =>
      expect(sentNamed("vessel.control.setSas")).toEqual([{ enabled: false }]),
    );
  });

  it("treats a confirmed vessel.control tombstone exactly like nothing having arrived", async () => {
    mount("nb-undef-tombstone", { w: 10, h: 20, controlMode: true });

    act(() => {
      // A whole-topic tombstone: the subject states there is no control record.
      // The store keeps `null` for this and `undefined` for never-arrived, so
      // the two ARE distinguishable at the read.
      fixture.emit("vessel.control", null);
    });
    await waitFor(() =>
      expect(fixture.store.sample("vessel.control")?.payload).toBeNull(),
    );

    // The widget does not distinguish them: `control?.sas` short-circuits on
    // `null`, so the display coercion and the dispatch refusal both behave
    // exactly as in the never-arrived case.
    expect(screen.getByRole("button", { name: "SAS OFF" })).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "SAS OFF" }).click();
      // Same ungated control as in the never-arrived test: its dispatch proves
      // the command path is live under a tombstone too.
      screen.getByRole("button", { name: "PRO" }).click();
    });
    await waitFor(() =>
      expect(sentNamed("vessel.control.setSasMode")).toEqual([{ mode: 1 }]),
    );
    expect(sentNamed("vessel.control.setSas")).toEqual([]);
  });

  it("arms fly-by-wire with no delay caveat at all when comms.delay has never arrived", async () => {
    mount("nb-undef-fbw-delay", { w: 10, h: 20, controlMode: true });

    act(() => {
      screen.getByRole("button", { name: "Arm FBW" }).click();
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "FBW ARMED" }),
      ).toBeInTheDocument(),
    );
    // `magnitudeOf(undefined)` is `null`, and `delayHigh` requires
    // `delaySeconds !== null`, so an unknown light-time renders as a
    // known-negligible one: stick control is offered with no warning. The
    // widget's own comment expects a 0 here ("0 when the delay feature is
    // disabled"), and absence lands on the same branch as that 0.
    expect(visibleText()).not.toMatch(/high signal delay/i);
    expect(visibleText()).not.toContain("DELAY");
  });

  it("warns about fly-by-wire delay only once comms.delay reports a real light-time", async () => {
    // The contrast case for the gate above.
    mount("nb-undef-fbw-delay-real", { w: 10, h: 20, controlMode: true });

    act(() => {
      screen.getByRole("button", { name: "Arm FBW" }).click();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "FBW ARMED" }),
      ).toBeInTheDocument(),
    );

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 4 });
    });

    await waitFor(() => expect(visibleText()).toMatch(/high signal delay/i));
  });

  it("reads the first vessel.identity to arrive as a vessel CHANGE, discarding the operator's commanded throttle", async () => {
    // `activeVesselId` is `undefined` until identity arrives, and it is compared
    // against the previous value with `!==`, so `undefined -> "v"` trips the
    // vessel-switch reset. The operator's own commanded throttle is thrown away
    // and re-seeded from the live readback, on a vessel that never changed.
    mount("nb-undef-vessel-switch", { w: 10, h: 20, controlMode: true });

    act(() => {
      fixture.emit("vessel.control", { sas: false, rcs: false, throttle: 0.2 });
    });
    const slider = screen.getByRole("slider", { name: "Throttle" });
    await waitFor(() => expect(slider).toHaveValue("0.2"));

    act(() => {
      screen.getByRole("button", { name: "FULL" }).click();
    });
    expect(slider).toHaveValue("1");

    act(() => {
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
      });
    });

    // Back to the live 0.2: the commanded FULL is gone, because the identity
    // read going from absent to present counts as switching craft.
    await waitFor(() => expect(slider).toHaveValue("0.2"));
  });
});
