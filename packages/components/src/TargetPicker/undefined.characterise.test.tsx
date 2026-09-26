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
 * What `undefined` means at every read site in this widget: a wait for
 * `target.available`, a flat "no target" claim for `vessel.target` (reached
 * identically by a tombstone), and a placeholder or skipped row for a missing
 * field. A non-number `bodyIndex` never dispatches.
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

    // The same absence rendered with two meanings: a fact about KSP for the target, a wait for the list.
    expect(visibleText(container)).toContain("No target set in KSP.");
    expect(visibleText(container)).toContain("Waiting for target list...");
    // Not the empty-list wording, which is a different branch.
    expect(visibleText(container)).not.toContain("No targets in range.");
  });

  it("offers no control of any kind before anything arrives", () => {
    renderPicker(fixture);

    // Zero buttons is the exact statement that BOTH gates fired.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Clear target" })).toBeNull();
    // The filter input is not gated, so the button count above is not an empty tree.
    expect(
      screen.getByRole("searchbox", { name: "Filter targets" }),
    ).toBeTruthy();
  });

  it("collapses to the no-target readout in compact mode, with no clear control", () => {
    // Below the 6 rows / 4 cols threshold the picker becomes a current-target readout, gated on the name alone.
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

    // An EMPTY list is a different statement from no list.
    await waitFor(() =>
      expect(visibleText(container)).toContain("No targets in range."),
    );
    expect(visibleText(container)).not.toContain("Waiting for target list");
  });

  it("treats a target.available tombstone as an empty list, not as a wait", async () => {
    // A tombstoned list renders the empty-list wording, like a real empty list.
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
    // A record without `entries` renders as though the producer had said "none".
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
    // A confirmed clear and a cold topic are one rendering here.
    const { container } = renderPicker(fixture);
    const beforeAnything = visibleText(container);
    expect(beforeAnything).toContain("No target set in KSP.");

    act(() => {
      fixture.emit("vessel.target", null);
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("No target set in KSP."),
    );
    // Byte-identical: indistinguishable to an operator.
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
    // Only `name` gates the summary, so missing fields are skipped rather than placeholdered.
    const { container } = renderPicker(fixture);
    act(() => {
      fixture.emit("vessel.target", { name: "Nameless Geom" });
    });

    await waitFor(() =>
      expect(visibleText(container)).toContain("Nameless Geom"),
    );
    expect(screen.getByRole("button", { name: "Clear target" })).toBeTruthy();
    expect(visibleText(container)).not.toContain("No target set in KSP");
    // No kind label: the span is not rendered at all.
    expect(visibleText(container)).not.toContain("Vessel");
    // No distance and no Δv, skipped rather than placeholdered.
    expect(visibleText(container)).not.toContain("Δv");
    expect(visibleText(container)).not.toContain(NULL_DISPLAY);
  });

  it("renders a distance but no Δv when the record carries position without velocity", async () => {
    // Half the geometry gives the distance and silently drops the closing rate.
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
    // Compact mode renders the distance only when finite, so the name stands alone.
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
    // The distanceless entry is emitted FIRST, so passing proves the sort moved it.
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
    // An unknown range sorts last.
    expect(rows.map((r) => visibleText(r).split(NULL_DISPLAY)[0])).toEqual([
      "Ranged VesselRelay · Orbiting800.0 m",
      "No Range Vessel",
    ]);
    // The row still renders, with the placeholder where the range goes.
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
    // The row is one line: the subtitle element is absent, not empty.
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

    // No command and no pending spinner: the click leaves no trace.
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

    // A truthiness gate, so it also swallows an empty-string id.
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(0));
    expect(screen.queryByLabelText("Setting target")).toBeNull();
  });

  /** A tombstoned `bodyIndex` must never become a real command on the wire. */
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

    // Nothing on the wire and no spinner: the click is inert.
    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(screen.queryAllByLabelText("Setting target")).toHaveLength(0);
  });
});
