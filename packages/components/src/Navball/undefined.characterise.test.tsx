import {
  clearActionHandlers,
  DashboardItemContext,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * Characterises what Navball does with each absent read other than attitude
 * (covered in `reading.test.tsx`):
 *  - an unread SAS/RCS arm is labelled with its bare name, neither ON nor OFF
 *  - an unread throttle is the null glyph, never 0%, and refuses relative steps
 *  - a SAS/RCS toggle with no boolean read is refused rather than guessed
 *  - an unknown control level fails open: the surface stays live
 *  - an unread `comms.delay` arms FBW with no delay caveat
 *  - the first `vessel.identity` to arrive reads as a vessel change
 */

const ATTITUDE = {
  heading: 90,
  pitch: 45,
  roll: 0,
  headingRootFrame: 90,
  pitchRootFrame: 45,
  rollRootFrame: 0,
};

/** `Sitrep.Contract.ControlState.None`: collapses to level 0, i.e. NOT controllable. */
const CONTROL_STATE_NONE = 0;

let fixture: StreamFixture;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  // Each mount registers ~30 actions, so back-to-back mounts would trip the register/sec budget.
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
  fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
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
  it("shows unnamed SAS and RCS toggles and no precision chip when nothing has arrived", () => {
    mount("nb-undef-nothing");

    // Not "SAS OFF" (unread is not confirmed off) and not bare "SAS" (the stability-assist mode button).
    expect(
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `RCS ${NULL_DISPLAY}` }),
    ).toBeInTheDocument();
    expect(visibleText()).not.toContain("SAS:");
    expect(visibleText()).not.toContain("SAS OFF");
    // The precision chip's dim state means off, so an unread precision draws no chip at all.
    expect(screen.queryByText("PRECISION")).toBeNull();
    expect(visibleText()).not.toContain("DELAY");
    // The throttle column rides `showDial`.
    expect(screen.queryByText("THR")).toBeNull();
  });

  it("draws the null glyph, not a zero-percent throttle, when vessel.control never arrives", async () => {
    mount("nb-undef-throttle");

    act(() => {
      // Attitude only, so the dial and throttle column render with no control record.
      fixture.emit("vessel.attitude", ATTITUDE);
    });

    await waitFor(() => expect(screen.getByText("THR")).toBeInTheDocument());
    expect(visibleText()).toContain(`THR${NULL_DISPLAY}`);
    expect(visibleText()).not.toContain("0 %");
  });

  it("draws the null glyph for a missing throttle field even when the control record itself arrived", async () => {
    mount("nb-undef-partial-control");

    act(() => {
      fixture.emit("vessel.attitude", ATTITUDE);
      fixture.emit("vessel.control", { sas: true });
    });

    // The partial record landed, so the glyph is the missing field and not a dropped emit.
    await waitFor(() =>
      expect(fixture.store.sample("vessel.control")?.payload).toEqual({
        sas: true,
      }),
    );
    expect(visibleText()).toContain(`THR${NULL_DISPLAY}`);
    expect(visibleText()).not.toContain("0 %");
  });
});

describe("Navball control surface: what undefined means today", () => {
  it("leaves the whole control surface live and unbannered when nothing has arrived", () => {
    mount("nb-undef-controls", { w: 10, h: 20, controlMode: true });

    // With no control level the widget fails open.
    expect(screen.queryByRole("note")).toBeNull();
    const sas = screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` });
    const rcs = screen.getByRole("button", { name: `RCS ${NULL_DISPLAY}` });
    expect(sas).not.toBeDisabled();
    expect(rcs).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "SAS ON" })).toBeNull();
    expect(screen.queryByRole("button", { name: "SAS OFF" })).toBeNull();
    // A step from an unread throttle is refused; the absolute commands stay live.
    const group = screen.getByRole("slider", {
      name: "Throttle",
    }).parentElement;
    expect(group?.textContent).toContain(NULL_DISPLAY);
    expect(screen.getByRole("button", { name: "+10%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "−10%" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ZERO" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "FULL" })).not.toBeDisabled();
  });

  it("banners and disables the surface only on a CONFIRMED uncontrollable vessel", async () => {
    // Contrast case: the widget does banner, so the fail-open above is absence routed to controllable.
    mount("nb-undef-controls-confirmed", {
      w: 10,
      h: 20,
      controlMode: true,
    });

    act(() => {
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_NONE });
    });

    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent(
        "Vessel not controllable: buttons disabled.",
      ),
    );
    expect(
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }),
    ).toBeDisabled();
  });

  it("refuses to dispatch a SAS or RCS toggle when vessel.control has never arrived", async () => {
    mount("nb-undef-toggle-refused", { w: 10, h: 20, controlMode: true });

    act(() => {
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }).click();
      screen.getByRole("button", { name: `RCS ${NULL_DISPLAY}` }).click();
      // A SAS-mode click has no absence gate, so its dispatch proves the command path is live.
      screen.getByRole("button", { name: "PRO" }).click();
    });

    await waitFor(() =>
      expect(sentNamed("vessel.control.setSasMode")).toEqual([{ mode: 1 }]),
    );

    // Inverting an unknown boolean would be a blind guess.
    expect(sentNamed("vessel.control.setSas")).toEqual([]);
    expect(sentNamed("vessel.control.setRcs")).toEqual([]);
    // The refusal is invisible: the button stays enabled.
    expect(
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }),
    ).not.toBeDisabled();
  });

  it("dispatches that same click once a real boolean has arrived", async () => {
    mount("nb-undef-toggle-allowed", { w: 10, h: 20, controlMode: true });

    act(() => {
      fixture.emit("vessel.control", { sas: true, rcs: false, throttle: 0 });
    });
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
      // The store keeps null for a tombstone and undefined for never-arrived; the widget treats both alike.
      fixture.emit("vessel.control", null);
    });
    await waitFor(() =>
      expect(fixture.store.sample("vessel.control")?.payload).toBeNull(),
    );

    expect(
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }),
    ).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: `SAS ${NULL_DISPLAY}` }).click();
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
    // An unknown light-time renders as a negligible one.
    expect(visibleText()).not.toMatch(/high signal delay/i);
    expect(visibleText()).not.toContain("DELAY");
  });

  it("warns about fly-by-wire delay only once comms.delay reports a real light-time", async () => {
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
    // Absent to present trips the vessel-switch reset on a vessel that never changed.
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

    await waitFor(() => expect(slider).toHaveValue("0.2"));
  });
});
