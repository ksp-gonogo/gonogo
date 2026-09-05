import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  createDelayRailStore,
  DelayRailContext,
  type DelayRailStore,
} from "./DelayRailContext";
import { PanelDelayRail } from "./PanelDelayRail";
import { PanelRailTargetContext } from "./PanelRailTarget";
import { VOICE_RAIL_TAGS } from "./railTags";
import { usePanelCrossing } from "./usePanelCrossing";

/*
 * No ResizeObserver stub here: the package setup already installs a no-op one,
 * and nothing below asserts on the published rail height. `PanelDelayRail`'s
 * own suite owns the drivable observer, because it is the file that measures.
 */

/** A widget that publishes a voice crossing, mounted beside the rail that draws it. */
function Talker({ amplitudes }: { amplitudes: readonly number[] | null }) {
  usePanelCrossing(
    amplitudes === null
      ? null
      : {
          tags: VOICE_RAIL_TAGS,
          label: "Your transmission crossing to Odyssey",
          amplitudes,
          spanSamples: 4,
        },
  );
  return null;
}

function inPanel(children: React.ReactNode, store: DelayRailStore) {
  function Harness() {
    const targetRef = useRef<HTMLDivElement>(null);
    return (
      <div ref={targetRef} data-testid="target">
        <PanelRailTargetContext.Provider value={targetRef}>
          <DelayRailContext.Provider value={store}>
            {children}
          </DelayRailContext.Provider>
        </PanelRailTargetContext.Provider>
      </div>
    );
  }
  return render(<Harness />);
}

describe("usePanelCrossing", () => {
  it("draws the ribbon on the rail of the panel that registered it", async () => {
    const store = createDelayRailStore();
    const { container } = inPanel(
      <>
        <Talker amplitudes={[0.2, 0.5, 0.9]} />
        <PanelDelayRail />
      </>,
      store,
    );
    expect(
      screen.getByRole("img", {
        name: "Your transmission crossing to Odyssey",
      }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-role="ribbon"]')).not.toBeNull();
    await act(async () => {});
  });

  /*
   * The rail used to mount only for a command. A transmission is the first
   * thing that occupies the gap without being one, so a rail that still asked
   * "is a command in flight" would draw nothing while the operator was talking.
   */
  it("mounts the rail for a crossing with no command anywhere near it", async () => {
    const store = createDelayRailStore();
    const { container } = inPanel(
      <>
        <Talker amplitudes={[0.4]} />
        <PanelDelayRail />
      </>,
      store,
    );
    expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
    await act(async () => {});
  });

  it("takes the crossing away when the transmission ends", async () => {
    const store = createDelayRailStore();
    const { container, rerender } = inPanel(
      <>
        <Talker amplitudes={[0.4]} />
        <PanelDelayRail />
      </>,
      store,
    );
    expect(container.querySelector("[data-rail-crossing]")).not.toBeNull();

    function Harness() {
      const targetRef = useRef<HTMLDivElement>(null);
      return (
        <div ref={targetRef} data-testid="target">
          <PanelRailTargetContext.Provider value={targetRef}>
            <DelayRailContext.Provider value={store}>
              <Talker amplitudes={null} />
              <PanelDelayRail />
            </DelayRailContext.Provider>
          </PanelRailTargetContext.Provider>
        </div>
      );
    }
    rerender(<Harness />);
    expect(container.querySelector("[data-rail-crossing]")).toBeNull();
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    await act(async () => {});
  });

  it("is a no-op with no rail in the tree", () => {
    expect(() => render(<Talker amplitudes={[0.5]} />)).not.toThrow();
  });

  it("has no axe violations with a crossing on the rail", async () => {
    const store = createDelayRailStore();
    const { container } = inPanel(
      <>
        <Talker amplitudes={[0.2, 0.5]} />
        <PanelDelayRail />
      </>,
      store,
    );
    await expectNoA11yViolations(container);
    await act(async () => {});
  });
});
