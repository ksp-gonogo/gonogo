import { useTelemetry } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VantageControl } from "./VantageControl";

/**
 * What `VantageControl` DOES today when `commandCentre.roster` reads
 * `undefined`, recorded before `useTelemetry` starts returning a `Reading`.
 *
 * The whole control funnels the roster through one absence gate,
 * `(roster ?? []).filter(...)`, and every visible consequence follows from it:
 * the option list, the empty popover, and (via `resolveHomeCentreId([])`
 * returning `undefined`) whether the trigger claims the selected vantage is
 * home. The gate cannot tell a cold topic from a confirmed tombstone, and
 * these tests pin that it does not try.
 */

/**
 * The raw read, beside the control, so a test asserting "null and undefined
 * render the same" also records WHICH of the two the control was handed.
 * `VantageControl` renders no trace of the distinction, so without this the
 * tombstone test could pass on a tombstone that never landed.
 */
function RosterProbe() {
  // Reads the ARM. It used to print `undefined` vs the JSON payload, because those
  // were the only two answers a read had; a tombstone and a cold start were the same
  // sentence. `pending` and `absent` are the same distinction, said out loud.
  const reading = useTelemetry("commandCentre.roster");
  const detail =
    reading.state === "observed" || reading.state === "stale"
      ? JSON.stringify(reading.value)
      : "";
  return <p>{`roster:${reading.state}${detail}`}</p>;
}

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["commandCentre.roster"],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <VantageControl />
      <RosterProbe />
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    /** Emit at the default `validAt: 0` and advance the pinned frame onto it. */
    emitRoster: (roster: unknown) => {
      act(() => {
        fixture.emit("commandCentre.roster", roster);
        fixture.store.beginFrame();
      });
    },
  };
}

describe("VantageControl: what undefined means for commandCentre.roster today", () => {
  it("with nothing on the wire, renders the selected id as its own label and asserts no centres exist", () => {
    const fixture = mount();

    // The label is the `selectedOption?.label ?? selected` fallback: no roster
    // entry to match, so the raw client default id is what the operator reads.
    // Nothing emitted, so the read is the bare `undefined` this whole file is
    // about, not a tombstone and not an empty array off the wire.
    expect(screen.getByText("roster:pending")).toBeInTheDocument();

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: ksc",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // KSC is NOT marked home before the roster arrives. `resolveHomeCentreId`
    // over an empty active list answers `undefined`, and `"ksc" === undefined`
    // is false, so the badge that appears the instant a roster lands is absent
    // here. This is the undefined-meaning "waiting for telemetry" being
    // rendered as the positive claim "this vantage is not home".
    expect(screen.queryByText("Home")).toBeNull();

    // Opening it makes the same conflation louder: a topic that has simply not
    // arrived is reported as a confirmed empty roster.
    fireEvent.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No command centres available",
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    fixture.unmount();
  });

  it("treats a confirmed roster tombstone exactly as it treats nothing-arrived", () => {
    const fixture = mount();

    // Land a real roster first, so this test cannot pass merely because the
    // tombstone never reached the store: the Home badge appearing proves the
    // subscription and the frame are live.
    fixture.emitRoster([{ id: "ksc", displayName: "KSC", active: true }]);
    expect(
      screen.getByRole("button", {
        name: "Command centre vantage: KSC (home)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();

    // `null` is the store's confirmed-absence tombstone, distinct from
    // `undefined`. `roster ?? []` collapses the two, so the control reverts to
    // the byte-identical never-arrived render: no distinction is implemented
    // here at all.
    fixture.emitRoster(null);
    // The probe is what proves the tombstone genuinely reached the read: the
    // control below renders no trace of which of the two it got.
    expect(screen.getByText("roster:absent")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Command centre vantage: ksc" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Home")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Command centre vantage: ksc" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No command centres available",
    );

    fixture.unmount();
  });

  it("keeps the keyboard path inert while the roster is absent, leaving the vantage untouched", () => {
    const fixture = mount();

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: ksc",
    });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // The `options.length === 0` early return and the `if (opt)` guard are both
    // downstream of the `roster ?? []` gate: with no roster there is nothing to
    // land on, so Enter must not re-point the whole view.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(fixture.client.selectedVantage).toBe("ksc");
    // Enter did not select, so the menu is still open.
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fixture.unmount();
  });

  it("drops a roster entry whose own id or active flag is missing, and reports the roster empty", () => {
    const fixture = mount();

    // A record arrived, but the fields the filter reads did not. `c.active &&
    // c.id != null` treats an undefined field as a negative fact, so a
    // half-populated entry is indistinguishable from no entry: the popover
    // still says no centres exist.
    fixture.emitRoster([
      { active: true, displayName: "Nameless" },
      { id: "ground:gs1", displayName: "Ground Station 1" },
    ]);

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: ksc",
    });
    fireEvent.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No command centres available",
    );
    expect(screen.queryByText("Ground Station 1")).toBeNull();

    fixture.unmount();
  });

  it("falls back to the raw id when only displayName is missing, and still marks it home", () => {
    const fixture = mount();

    // The entry passes the filter, so only `c.displayName ?? c.id` is in play:
    // a missing display name renders the wire id verbatim rather than a
    // placeholder.
    fixture.emitRoster([{ id: "ksc", active: true }]);

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: ksc (home)",
    });
    expect(screen.getByText("Home")).toBeInTheDocument();

    fireEvent.click(trigger);
    const option = screen.getByRole("option");
    expect(option).toHaveTextContent("ksc");
    expect(option).toHaveTextContent("Home");

    fixture.unmount();
  });
});
