import { clearAugments } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * What this widget does when `career.status` stops being current: it KEEPS the
 * board, and this file is what stops that being quietly reversed.
 *
 * The contract board is a set of facts. A contract joins the offered list, gets
 * accepted, or completes because the player or the game did something, and
 * neither can happen down a link that has stopped delivering, so the last board
 * we were sent is still the board. Withholding it would swap a real programme
 * for "Awaiting contract telemetry", which is the widget's cold-start sentence:
 * the operator would read a quiet link as a career with nothing in it.
 *
 * A widget that renders nothing passes almost every test written about it, so
 * the assertions here are about what is still on screen once the link is gone,
 * and about the deadline countdown continuing to be computed rather than frozen.
 */

const CARRIED = ["career.status", "vessel.state"];

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

/**
 * The active card's remaining-time phrase, e.g. "1d left". Anchored on the
 * leading digit because `visibleText` joins adjacent nodes with no separator,
 * so the contract title runs straight into it.
 */
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

describe("ContractManager when career telemetry is no longer current", () => {
  it("keeps the active and offered boards, which the player cannot have changed", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 100,
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
    // The counts are counts of held facts, not a claim about now, and they must
    // not collapse to zero.
    expect(visibleText(container)).toContain("1 active");
    expect(visibleText(container)).toContain("1 offered");
    // Emphatically NOT the cold-start sentence: that one says no contract
    // telemetry has ever arrived, and one has.
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    // Nor the confirmed-empty one, which would be KSP stating the board is bare.
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });

  it("holds the deadline where the last sample left it instead of inventing progress", async () => {
    // The deadline is not a remembered number: it is a fixed `deadlineUt` on the
    // record, minus the frame's view time. That view time is the CONFIRMED edge,
    // so with nothing arriving it stops advancing and the phrase holds, which is
    // why the board needs no staleness caption of its own. The wrong behaviour
    // would be a countdown that ran on desk time and marched a held contract to
    // "expired" with no evidence that it did.
    const fixture = setupStreamFixture({ carriedChannels: CARRIED });
    const container = mount(fixture);
    emitBoard(fixture);
    await waitFor(() =>
      expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument(),
    );
    const before = timeLeft(container);
    expect(before).toBe("1d left");

    goStale(fixture);
    act(() => {
      // An hour of desk time with nothing confirmed.
      fixture.wall.advanceBy(3600);
      fixture.store.beginFrame();
    });

    expect(timeLeft(container)).toBe(before);
    expect(visibleText(container)).not.toContain("expired");
  });

  it("still shows the cold-start placeholder when nothing ever arrived", async () => {
    // The control for the sentence above: a link that never delivered is a
    // different statement from one that stopped, and the placeholder belongs
    // only to the first.
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 100,
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
