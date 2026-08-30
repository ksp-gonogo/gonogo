import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

/**
 * CHARACTERISATION: what `undefined` MEANS at each of ActionGroup's read sites
 * today, recorded before `useTelemetry` returns a `Reading`.
 *
 * The widget has four telemetry reads and every one of them can be `undefined`:
 *
 *   - `useTelemetry("vessel.control")`   -> the group registry AND the group value
 *   - `useTelemetry("vessel.structure")` -> Stage's value only
 *   - `useTelemetry("time.warp")?.paused`     -> the "Paused" unavailable badge
 *   - `useTelemetry("comms.link")?.connected` -> the "No signal" unavailable badge
 *
 * They do NOT agree on what absence means. The value read treats `undefined` as
 * "unknown" and renders NULL_DISPLAY. The two badge reads treat it as "fine, no
 * reason to warn" (each needs a CONFIRMED `true`/`false` to fire). `null` inside
 * a payload is a third thing again: a confident "OFF". Each test below names
 * which of those it pins.
 */

const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

/** Every topic this widget reads, so nothing falls back to a legacy source. */
const CARRIED = [
  "vessel.control",
  "vessel.structure",
  "time.warp",
  "comms.link",
];

function mount(groupId: string, instanceId = "ag-characterise") {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 0,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ActionGroupComponent
          config={{ actionGroupId: groupId }}
          id={instanceId}
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, commandHandler };
}

/** Let a fire-and-forget command settle, so "no dispatch" is a real observation
 *  and not just an assertion made too early. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CONTROL_ALL_OFF = {
  sas: false,
  sasMode: 0,
  rcs: false,
  gear: false,
  brakes: false,
  lights: false,
  abort: false,
  precisionControl: false,
  throttle: 0,
  actionGroups: [],
};

describe("ActionGroup: nothing has arrived at all", () => {
  it("renders the configured group, named and enabled, with NULL_DISPLAY for its state", () => {
    mount("SAS");

    // `useActionGroupFrom(undefined, "SAS")` still resolves: SAS is a STOCK
    // singleton in the static half of the registry, so an absent
    // `vessel.control` never reaches the `!group` placeholder.
    expect(screen.queryByText("No action group configured")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Toggle SAS" });
    // `isUnknown = value === undefined` -> NULL_DISPLAY. This is the one site
    // that reads absence as "unknown" rather than as a state.
    expect(toggle.textContent).toBe(NULL_DISPLAY);
    // `isOn` is `value === true`, so an absent read presents as not-pressed.
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // The control is fully live-looking: nothing about the widget says the
    // number behind it never arrived.
    expect(toggle).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename SAS" })).toBeTruthy();
  });

  it("shows no unavailable badge: absent pause/comms reads are read as 'nothing to warn about'", () => {
    mount("SAS");

    // `isPaused === true` and `commConnected === false` both need a CONFIRMED
    // value. `undefined` fires neither, so the widget asserts the action can
    // fire right now off no evidence at all.
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.queryByText("No signal")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }).getAttribute("title"),
    ).toBe("Toggle SAS");
  });
});

describe("ActionGroup: the absence gates", () => {
  it("`value === undefined` gate fires before the first sample and stops once one lands", async () => {
    const { fixture } = mount("SAS");

    expect(screen.getByRole("button", { name: "Toggle SAS" }).textContent).toBe(
      NULL_DISPLAY,
    );

    act(() => {
      fixture.emit("vessel.control", CONTROL_ALL_OFF);
    });

    // A CONFIRMED false is a different render from an absent read: "OFF", not
    // NULL_DISPLAY. That distinction is what the gate exists for.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("OFF"),
    );
  });

  it("`typeof value !== 'boolean'` gate fires: a click with nothing arrived dispatches NO command", async () => {
    const { fixture, commandHandler } = mount("SAS");

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();

    // `buildToggleArgs` returns TOGGLE_INVALID for a non-boolean value, and
    // `handleToggle` returns early. So the widget silently swallows the click:
    // no command, no feedback, nothing on the wire.
    expect(commandHandler).not.toHaveBeenCalled();
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("`isPaused === true` gate is reachable: a confirmed pause DOES badge, an absent one does not", async () => {
    const { fixture } = mount("SAS");

    expect(screen.queryByText("Paused")).toBeNull();

    act(() => {
      fixture.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: true,
      });
    });

    await waitFor(() => expect(screen.getByText("Paused")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Toggle SAS" }).getAttribute("title"),
    ).toBe("Paused");
  });

  it("`commConnected === false` gate is reachable: a confirmed loss DOES badge, an absent one does not", async () => {
    const { fixture } = mount("SAS");

    expect(screen.queryByText("No signal")).toBeNull();

    act(() => {
      fixture.emit("comms.link", { connected: false });
    });

    await waitFor(() => expect(screen.getByText("No signal")).toBeTruthy());
  });
});

describe("ActionGroup (Stage): the one group whose absence gate does not block the command", () => {
  it("reads NULL_DISPLAY off an absent vessel.structure yet still commands a stage on click", async () => {
    const { fixture, commandHandler } = mount("Stage", "ag-stage");

    const toggle = screen.getByRole("button", { name: "Toggle Stage" });
    // `structure?.currentStage` is undefined, so the readout is unknown.
    expect(toggle.textContent).toBe(NULL_DISPLAY);

    act(() => {
      toggle.click();
    });

    // `buildToggleArgs` short-circuits Stage to `null` BEFORE the boolean
    // check, so Stage is the only group that actuates the vessel off a read
    // that never arrived.
    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("vessel.control.stage", null),
    );
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });
});

describe("ActionGroup: a partial payload", () => {
  it("a vessel.control that arrived WITHOUT the group's field reverts to NULL_DISPLAY", async () => {
    const { fixture, commandHandler } = mount("SAS");

    // Land a real value first, so the partial record below is provably
    // delivered rather than silently dropped: NULL_DISPLAY alone is also the
    // never-arrived render, and asserting it from a cold mount proves nothing.
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("ON"),
    );

    act(() => {
      // The record is here; `sas` is not. The optional-chain read collapses
      // this to the same `undefined` the never-arrived case produces, so the
      // widget DISCARDS the value it had rather than holding the last known.
      const { sas: _dropped, ...withoutSas } = CONTROL_ALL_OFF;
      fixture.emit("vessel.control", withoutSas);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();
    expect(commandHandler).not.toHaveBeenCalled();
  });

  it("a custom group missing from the arrived actionGroups list reads unknown, not off", async () => {
    // The other absence gate on the value path: a CUSTOM group resolves by
    // `index` through `control?.actionGroups?.find(...)`, and a miss returns
    // `undefined`. That is the state a saved AGX group lands in after AGX is
    // uninstalled, and the code chose "unknown, not false" for it.
    const { fixture } = mount("AG1", "ag-custom");

    act(() => {
      fixture.emit("vessel.control", {
        ...CONTROL_ALL_OFF,
        actionGroups: [{ index: 4, name: "AG4", state: true }],
      });
    });
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("vessel.control")).toBe(true),
    );

    const toggle = screen.getByRole("button", { name: "Toggle AG1" });
    expect(toggle.textContent).toBe(NULL_DISPLAY);
    // Still presented as operable, and still silently inert on click.
    expect(toggle).not.toBeDisabled();
  });
});

describe("ActionGroup: null versus undefined", () => {
  it("a NULL field reads as a confident OFF while the command path still refuses it", async () => {
    // The site that distinguishes them is `isUnknown = value === undefined`,
    // which is `undefined`-only. So a tombstoned FIELD (`sas: null`) skips the
    // unknown branch entirely and falls through `value === true` to "OFF": the
    // widget states the vessel's SAS is off on the strength of a null. The
    // command path disagrees with the readout, because `buildToggleArgs`
    // demands a real boolean, so the pill says OFF and pressing it does
    // nothing.
    const { fixture, commandHandler } = mount("SAS");

    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: null });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("OFF"),
    );

    act(() => {
      screen.getByRole("button", { name: "Toggle SAS" }).click();
    });
    await settle();
    expect(commandHandler).not.toHaveBeenCalled();
  });

  it("a whole-topic tombstone reads exactly like nothing having arrived", async () => {
    // A `null` PAYLOAD (the store's confirmed "there is no value") reaches the
    // widget through `control?.…`, which erases the difference between a
    // tombstone and a cold topic. Both render NULL_DISPLAY, so the operator
    // cannot tell "the mod says there is no vessel control" from "waiting".
    const { fixture } = mount("SAS");

    // Observed value first, so the tombstone is provably delivered: it has to
    // move the render off "ON" for the assertion below to mean anything.
    act(() => {
      fixture.emit("vessel.control", { ...CONTROL_ALL_OFF, sas: true });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe("ON"),
    );

    act(() => {
      fixture.emit("vessel.control", null);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Toggle SAS" }).textContent,
      ).toBe(NULL_DISPLAY),
    );
    expect(screen.queryByText("No action group configured")).toBeNull();
  });
});
