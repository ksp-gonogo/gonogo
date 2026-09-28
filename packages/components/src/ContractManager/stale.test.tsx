import { clearAugments } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * ContractManager keeps the board when `career.status` stops being current: the
 * board is a set of facts, and withholding it would read a quiet link as a
 * career with nothing in it. The assertions are about what is still on screen
 * and about the deadline staying computed.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
});

function mount(fixture: ReturnType<typeof setupStreamFixture>) {
  const { container, unmount } = render(
    <fixture.Provider>
      <ContractManagerComponent config={{}} id="cm-stale" w={8} h={10} />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

/** One active contract with a live deadline, plus one on the offered board. */
function emitBoard(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("career.status", {
      contracts: {
        active: [
          {
            id: "9001",
            title: "Orbit Kerbin",
            agency: "World-Firsts",
            state: "Active",
            // 1 Kerbin day (6h) past the pinned view UT of 100.
            deadlineUt: 21_700,
            parameters: [
              { title: "Reach orbit", state: "Incomplete", stateOrdinal: 0 },
            ],
          },
        ],
        offered: [
          { id: "9002", title: "Test a decoupler", agency: "Probodobodyne" },
        ],
      },
    });
  });
}

/** The active card's remaining-time phrase, anchored on the leading digit because `visibleText` joins nodes with no separator. */
function timeLeft(container: HTMLElement): string | undefined {
  return visibleText(container).match(/(\d[^ ]* left)/)?.[1];
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("ContractManager when career telemetry is held", () => {
  it("keeps the active and offered boards, which the player cannot have changed", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitBoard(fixture);
    await waitFor(() =>
      expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument(),
    );

    goStale(fixture);

    expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument();
    expect(screen.getByText("Test a decoupler")).toBeInTheDocument();
    expect(screen.getByText("Reach orbit")).toBeInTheDocument();
    // Counts of held facts must not collapse to zero.
    expect(visibleText(container)).toContain("1 active");
    expect(visibleText(container)).toContain("1 offered");
    // Not the cold-start sentence: contract telemetry has arrived.
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    // Nor the confirmed-empty one.
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });

  it("holds the deadline where the last sample left it instead of inventing progress", async () => {
    // The deadline is `deadlineUt` minus the confirmed view UT, so it holds rather than marching to "expired" on desk time.
    const fixture = setupStreamFixture({
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitBoard(fixture);
    await waitFor(() =>
      expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument(),
    );
    const before = timeLeft(container);
    expect(before).toBe("1d left");

    goStale(fixture);
    act(() => {
      fixture.wall.advanceBy(3600);
      fixture.store.beginFrame();
    });

    expect(timeLeft(container)).toBe(before);
    expect(visibleText(container)).not.toContain("expired");
  });

  it("marks each held card and kills the controls that act on it", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitBoard(fixture);
    await waitFor(() =>
      expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument(),
    );
    // The control: without it the assertions below would pass on a widget that marked and disabled unconditionally.
    expect(screen.queryAllByText("OFFLINE")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeEnabled();

    goStale(fixture);

    // One per card, beside its own deadline.
    expect(screen.getAllByText("OFFLINE")).toHaveLength(2);
    // A Cancel against a held board forfeits a contract whose current state cannot be read.
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Accept/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Decline/ })).toBeDisabled();
    // Disabled, not hidden: a missing control reads as a contract that cannot be cancelled.
    expect(visibleText(container)).toContain("Cancel");
  });

  it("still shows the cold-start placeholder when nothing ever arrived", async () => {
    // A link that never delivered gets the placeholder; one that stopped does not.
    const fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
    mount(fixture);
    goStale(fixture);

    await waitFor(() =>
      expect(
        screen.getByText(/Awaiting contract telemetry/i),
      ).toBeInTheDocument(),
    );
  });
});
