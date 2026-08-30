import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TargetPickerComponent } from "./index";

/**
 * Characterisation of what `undefined` MEANS at every read site in this widget,
 * recorded before `useTelemetry` starts returning a `Reading`.
 *
 * Both of this widget's reads are still bare payloads (`target.available` and
 * `vessel.target`), and between them they give `undefined` three different
 * meanings with nothing in the code distinguishing them:
 *
 * - `available === undefined` means "nothing has arrived yet" and renders a
 *   waiting hint, which is the one site that reads it as a currency question
 * - `target?.name === undefined` means "KSP has no target", asserted flatly, and
 *   is reached identically by a never-arrived topic and by a tombstone
 * - a missing FIELD inside an entry or the target record means "the producer had
 *   nothing to say", and renders as a placeholder or as a silently skipped row
 *
 * Two findings worth reading the tests for: the two topics disagree about
 * whether `null` and `undefined` are the same thing, and the Body dispatch gate
 * is written `=== undefined` so a `bodyIndex: null` entry sends a command with a
 * null index rather than being suppressed.
 */

function renderPicker(
  fixture: StreamFixture,
  opts: { w?: number; h?: number; instanceId?: string } = {},
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider
        value={{ instanceId: opts.instanceId ?? "tp-c" }}
      >
        <TargetPickerComponent
          id={opts.instanceId ?? "tp-c"}
          w={opts.w ?? 10}
          h={opts.h ?? 14}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

function emitAvailable(
  fixture: StreamFixture,
  entries: readonly Record<string, unknown>[],
) {
  act(() => {
    fixture.emit("target.available", { entries });
  });
}

describe("TargetPicker: nothing has arrived on either topic", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("states both absences at once, in two different vocabularies", () => {
    const { container } = renderPicker(fixture);

    // The same fact (nothing has arrived) rendered twice with two different
    // meanings assigned to it: the target read calls it a fact about KSP, the
    // list read calls it a wait. Pinned together because the migration splits
    // these two sites apart and only one of them keeps its wording honestly.
    expect(visibleText(container)).toContain("No target set in KSP.");
    expect(visibleText(container)).toContain("Waiting for target list...");
    // Not the empty-list wording: that is a different branch and this test
    // would otherwise pass against it.
    expect(visibleText(container)).not.toContain("No targets in range.");
  });

  it("offers no control of any kind before anything arrives", () => {
    renderPicker(fixture);

    // Specific rather than "renders nothing": the Clear button is gated on the
    // target read and every row on the list read, so zero buttons is the exact
    // statement that BOTH gates fired.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Clear target" })).toBeNull();
    // The filter input is NOT gated and is present regardless, which is what
    // makes the button count above meaningful rather than an empty tree.
    expect(
      screen.getByRole("searchbox", { name: "Filter targets" }),
    ).toBeTruthy();
  });

  it("collapses to the no-target readout in compact mode, with no clear control", () => {
    // Below the 6 rows / 4 cols threshold the whole picker is replaced by a
    // current-target readout, and `tarName` falsy is the only gate in it.
    const { container } = renderPicker(fixture, { w: 3, h: 4 });

    expect(visibleText(container)).toContain("No target set");
    expect(visibleText(container)).not.toContain("Waiting for target list");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("TargetPicker: the target.available absence gate", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("swaps the waiting hint for the empty-list hint once a list with no entries arrives", async () => {
    const { container } = renderPicker(fixture);
    expect(visibleText(container)).toContain("Waiting for target list...");

    emitAvailable(fixture, []);

    // The gate is `available === undefined`, and this is the pair that proves it
    // fires: an EMPTY list is a different statement from no list, and the widget
    // renders it differently today.
    await waitFor(() =>
      expect(visibleText(container)).toContain("No targets in range."),
    );
    expect(visibleText(container)).not.toContain("Waiting for target list");
  });

  it("treats a target.available tombstone as an empty list, not as a wait", async () => {
    // null vs undefined, and this site DOES distinguish them, though only by
    // accident of the gate being spelled `=== undefined`. A tombstone falls
    // through to `available?.entries ?? []` and renders the empty-list wording,
    // exactly as a real empty list does.
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("target.available", null);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("No targets in range."),
    );
    expect(visibleText(container)).not.toContain("Waiting for target list");
  });

  it("treats a list record with no entries field as an empty list", async () => {
    // The `?? []` fallback: a record that arrived but carried no `entries` is a
    // partial payload, and it renders as though the producer had said "none".
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("target.available", {});
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("No targets in range."),
    );
  });
});

describe("TargetPicker: the vessel.target absence gate", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("treats a vessel.target tombstone as identical to never-arrived", async () => {
    // null vs undefined, and this site does NOT distinguish them, in the same
    // file that does distinguish them on `target.available` above. Both reach
    // the same flat claim through `target?.name`, so a confirmed clear and a
    // cold topic are one rendering.
    const { container } = renderPicker(fixture);
    const beforeAnything = visibleText(container);
    expect(beforeAnything).toContain("No target set in KSP.");

    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("No target set in KSP."),
    );
    // Byte-identical, which is the strongest form of "these two states are
    // indistinguishable to an operator".
    expect(visibleText(container)).toBe(beforeAnything);
  });

  it("shows the clear control only once a named target record arrives", async () => {
    renderPicker(fixture);
    expect(screen.queryByRole("button", { name: "Clear target" })).toBeNull();

    act(() => {
      fixture.emit("vessel.target", {
        name: "Test Station",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
        relativeVelocity: { x: -2.5, y: 0, z: 0 },
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Clear target" })).toBeTruthy(),
    );
  });
});

describe("TargetPicker: a partial vessel.target record", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("renders the name and the clear control from a record carrying nothing else", async () => {
    // Only `name` is gated for the whole summary, so a record with one field
    // reads as a fully-known target: the kind label and the distance are simply
    // skipped, not placeholdered, and the operator gets no signal that the rest
    // of the record never came.
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("vessel.target", { name: "Nameless Geom" });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Nameless Geom"),
    );
    expect(screen.getByRole("button", { name: "Clear target" })).toBeTruthy();
    expect(visibleText(container)).not.toContain("No target set in KSP");
    // No kind label: `targetKindLabel(undefined)` is undefined and the span is
    // not rendered at all.
    expect(visibleText(container)).not.toContain("Vessel");
    // No distance and no Δv, skipped rather than shown as a placeholder.
    expect(visibleText(container)).not.toContain("Δv");
    expect(visibleText(container)).not.toContain(NULL_DISPLAY);
  });

  it("renders a distance but no Δv when the record carries position without velocity", async () => {
    // `radialSpeed` needs both Vec3s, so half the geometry gives the distance
    // and silently drops the closing rate.
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("vessel.target", {
        name: "Half Geom",
        kind: 0,
        relativePosition: { x: 1500, y: 0, z: 0 },
      });
    });

    await waitFor(() => expect(visibleText(container)).toContain("1.5 km"));
    expect(visibleText(container)).toContain("Vessel");
    expect(visibleText(container)).not.toContain("Δv");
  });

  it("shows no distance in compact mode when the record carries no position", async () => {
    const { container } = renderPicker(fixture, { w: 3, h: 4 });
    act(() => {
      fixture.emit("vessel.target", { name: "Nameless Geom" });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Nameless Geom"),
    );
    // Compact mode renders the distance only when it is a finite number, so an
    // absent position leaves the name standing alone with no placeholder.
    expect(visibleText(container)).toBe("TARGETNameless Geom");
  });
});

describe("TargetPicker: a partial target.available entry", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("renders the null placeholder for an entry with no distance and sorts it last", async () => {
    renderPicker(fixture);
    // Emitted with the distanceless entry FIRST, so passing this means the sort
    // moved it rather than the wire order happening to agree.
    emitAvailable(fixture, [
      {
        kind: 0,
        name: "No Range Vessel",
        vesselId: "v-none",
        isCurrent: false,
      },
      {
        kind: 0,
        name: "Ranged Vessel",
        vesselId: "v-ranged",
        vesselType: 6,
        situation: 3,
        distance: 800,
        isCurrent: false,
      },
    ]);

    const section = await screen.findByRole("button", { name: /^Vessels/ });
    const body = document.getElementById("target-picker-section-vessels");
    expect(section).toBeTruthy();
    expect(body).toBeTruthy();
    const rows = within(body as HTMLElement).getAllByRole("button");
    // `magnitudeOf(undefined) ?? POSITIVE_INFINITY` puts an unknown range last.
    expect(rows.map((r) => visibleText(r).split(NULL_DISPLAY)[0])).toEqual([
      "Ranged VesselRelay · Orbiting800.0 m",
      "No Range Vessel",
    ]);
    // The row itself still renders, with the placeholder where the range goes:
    // an unknown distance is not a reason to hide a targetable.
    expect(within(rows[1]).getByText(NULL_DISPLAY)).toBeTruthy();
  });

  it("renders no subtitle for an entry with neither vesselType nor situation", async () => {
    renderPicker(fixture);
    emitAvailable(fixture, [
      {
        kind: 0,
        name: "No Meta Vessel",
        vesselId: "v1",
        distance: 500,
        isCurrent: false,
      },
    ]);

    const rows = await screen.findAllByRole("button", {
      name: /^No Meta Vessel/,
    });
    // `entrySubtitle` returns null when neither field resolves, so the row is
    // one line: the subtitle element is absent, not empty.
    for (const row of rows) {
      expect(visibleText(row)).toBe("No Meta Vessel500.0 m");
    }
  });
});

describe("TargetPicker: the dispatch gates on an entry's id fields", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    fixture = setupStreamFixture({
      carriedChannels: [],
      pinnedUt: 0,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    clearActionHandlers();
  });

  it("makes a Body row with no bodyIndex a silent no-op click", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, [
      { kind: 1, name: "Ghost Body", distance: 500, isCurrent: false },
    ]);

    const rows = await screen.findAllByRole("button", { name: /^Ghost Body/ });
    await user.click(rows[0]);

    // `if (entry.bodyIndex === undefined) return` fires: no command, and no
    // pending spinner either, so the click leaves no trace at all.
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(0));
    expect(screen.queryByLabelText("Setting target")).toBeNull();
  });

  it("makes a Vessel row with no vesselId a silent no-op click", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, [
      { kind: 0, name: "Ghost Vessel", distance: 500, isCurrent: false },
    ]);

    const rows = await screen.findAllByRole("button", {
      name: /^Ghost Vessel/,
    });
    await user.click(rows[0]);

    // `if (!entry.vesselId) return` is a TRUTHINESS gate here, unlike the Body
    // branch's `=== undefined`, so it also swallows an empty-string id.
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(0));
    expect(screen.queryByLabelText("Setting target")).toBeNull();
  });

  /**
   * Recorded prior behaviour: "DISPATCHES a Body row whose bodyIndex is a
   * tombstone, sending the null onward". The gate was `=== undefined`, so a
   * confirmed-no-index entry passed it and a delayed `vessel.target.set` went to
   * the craft carrying `bodyIndex: null`, with the row showing a spinner for a
   * command that could not succeed.
   *
   * An absence became a real command on the wire, which is the sharpest form of
   * the whole class. Any non-number refuses now.
   */
  it("refuses to dispatch a Body row whose bodyIndex is a tombstone", async () => {
    const user = userEvent.setup();
    renderPicker(fixture);
    emitAvailable(fixture, [
      {
        kind: 1,
        name: "Null Body",
        bodyIndex: null,
        distance: 500,
        isCurrent: false,
      },
    ]);

    const rows = await screen.findAllByRole("button", { name: /^Null Body/ });
    await user.click(rows[0]);

    // Nothing on the wire, and no spinner: the click is inert rather than
    // optimistically pending against a command that could never land.
    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(screen.queryAllByLabelText("Setting target")).toHaveLength(0);
  });
});
