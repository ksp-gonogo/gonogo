import { CommandErrorCode, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CommandHandle,
  createDelayRailStore,
  DelayRailContext,
} from "./DelayRailContext";
import { PanelDelayRail } from "./PanelDelayRail";
import { PanelRailTargetContext } from "./PanelRailTarget";
import type { InFlightCommandLike } from "./toInFlightListItems";

const IN_FLIGHT: InFlightCommandLike[] = [
  {
    id: "a",
    label: "Launch",
    command: "ksp.launch",
    reachEtaSeconds: 5,
    replyEtaSeconds: 9,
    predictedPhase: "in-transit",
  },
];

function handle(id: string): CommandHandle {
  return {
    id,
    inFlight: IN_FLIGHT,
    shape: "discrete",
    effectiveDelaySeconds: 5,
  };
}

// A drivable ResizeObserver so a test can supply the rail's measured height:
// jsdom has no layout, and the package setup installs a no-op stub. This
// stands in for it, capturing the callback so `drive()` can fire it with a
// chosen contentRect.
interface ROEntry {
  target: Element;
  contentRect: { width: number; height: number };
}
class DrivableResizeObserver {
  static instances: DrivableResizeObserver[] = [];
  readonly observed = new Set<Element>();
  readonly callback: (entries: ROEntry[]) => void;
  constructor(callback: (entries: ROEntry[]) => void) {
    this.callback = callback;
    DrivableResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}

function drive(el: Element, height: number) {
  act(() => {
    for (const ro of DrivableResizeObserver.instances) {
      if (ro.observed.has(el)) {
        ro.callback([{ target: el, contentRect: { width: 300, height } }]);
      }
    }
  });
}

const realResizeObserver = globalThis.ResizeObserver;

/** A target element (provided via `PanelRailTargetContext`, exactly as `Panel`
 * provides its container) the rail publishes `--panel-rail-height` onto.
 * Captured by ref into state so it is non-null for the rail's effect, the same
 * one-render-late availability the real Panel container has. */
function inPanel(rail: JSX.Element, store = createDelayRailStore()) {
  function Harness() {
    const targetRef = useRef<HTMLDivElement>(null);
    return (
      <div ref={targetRef} data-testid="target">
        <PanelRailTargetContext.Provider value={targetRef}>
          <DelayRailContext.Provider value={store}>
            {rail}
          </DelayRailContext.Provider>
        </PanelRailTargetContext.Provider>
      </div>
    );
  }
  return render(<Harness />);
}

function targetOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="target"]') as HTMLElement;
}

describe("PanelDelayRail", () => {
  beforeEach(() => {
    DrivableResizeObserver.instances = [];
    globalThis.ResizeObserver =
      DrivableResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  it("renders the delay UI for an active handle in context", () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    // v3: the rail renders the discrete handle as the glow-band strip (an
    // <svg role="img"> whose accessible name starts "In-flight commands"), not
    // the pre-v3 monospace list.
    expect(
      container.querySelector('[aria-label^="In-flight commands"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-role="glow"]')).not.toBeNull();
  });

  it("renders the rail chrome strip element for an active handle", () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
  });

  it("has no axe violations with an active handle", async () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    await expectNoA11yViolations(container);
  });

  it("renders nothing and sets no rail element when no handles are active (snapshot-stable for no-command widgets)", () => {
    const { container } = inPanel(<PanelDelayRail />);
    // Renders null: no rail element at all, so a no-command widget's Panel DOM
    // is byte-identical to before this rail existed.
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    expect(
      container.querySelector('[aria-label="In-flight commands"]'),
    ).toBeNull();
    // No var published: the panel reads the `var(--panel-rail-height, 0px)`
    // fallback (effective height 0).
    expect(
      targetOf(container).style.getPropertyValue("--panel-rail-height"),
    ).toBe("");
  });

  it("renders nothing for a registered but idle/instant handle (empty inFlight, nothing to draw)", () => {
    // A meta-vantage / not-yet-dispatched command registers (so its must-consume
    // token is marked) but its CommandDelay would draw nothing, so the rail
    // stays absent, exactly as the inline CommandDelay drew nothing before.
    const store = createDelayRailStore();
    store.register({
      id: "instant",
      inFlight: [],
      shape: "discrete",
      effectiveDelaySeconds: 0,
    });
    const { container } = inPanel(<PanelDelayRail />, store);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    expect(
      targetOf(container).style.getPropertyValue("--panel-rail-height"),
    ).toBe("");
  });

  it("renders nothing for a delayed stream handle with no buffers to draw", () => {
    // A stream-shaped command whose delay UX is drawn elsewhere (the Navball's
    // trim command shares vessel.control.setAxes with the axes but has no
    // readback channel of its own) registers with no `streams`. ControlDelayStream
    // draws nothing from an empty array, so the rail must not mount an empty band.
    const store = createDelayRailStore();
    store.register({
      id: "bufferless-stream",
      inFlight: [],
      shape: "stream",
      effectiveDelaySeconds: 1.6,
    });
    const { container } = inPanel(<PanelDelayRail />, store);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
  });

  it("publishes its measured height into --panel-rail-height on the panel target", () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    const rail = container.querySelector(
      "[data-panel-rail-frame]",
    ) as HTMLElement;
    drive(rail, 48);
    expect(
      targetOf(container).style.getPropertyValue("--panel-rail-height"),
    ).toBe("48px");
  });

  describe("pin-to-grow (v4)", () => {
    function railButton(): HTMLButtonElement {
      return screen.getByRole("button", {
        name: /signal-delay detail/i,
      }) as HTMLButtonElement;
    }

    it("is a button, collapsed by default (aria-pressed/expanded false), showing the rail summary not the detail list", () => {
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      const btn = railButton();
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(btn).toHaveAttribute("aria-expanded", "false");
      expect(btn).toHaveAttribute("data-pinned", "false");
      // Collapsed = the grazing-glow summary, not the detail list.
      expect(container.querySelector('[data-role="glow"]')).not.toBeNull();
      expect(container.textContent).not.toContain("Launch");
    });

    it("pins on activation and grows the detail IN PLACE (the inline list), unpins on Escape", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      const btn = railButton();

      await user.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "true");
      expect(btn).toHaveAttribute("aria-expanded", "true");
      // Grown: the fuller detail renders in place (the summary glow is replaced
      // by the square-icon tile), inside the rail button, no separate overlay.
      // The command's label rides the tile's accessible name (visible text is
      // the icon + countdown).
      expect(container.querySelector('[data-role="glow"]')).toBeNull();
      // The command's label rides the queue square's accessible name.
      expect(container.querySelector('[aria-label*="Launch"]')).not.toBeNull();
      expect(container.querySelector("[data-delay-float]")).toBeNull();

      await user.keyboard("{Escape}");
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(container.querySelector('[data-role="glow"]')).not.toBeNull();
      expect(btn).toHaveFocus();
    });

    it("re-activating collapses it again (toggle)", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      inPanel(<PanelDelayRail />, store);
      const btn = railButton();
      await user.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "true");
      await user.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });

    it("shows a sighted arrow-only collapse hint while pinned, hidden again once un-pinned; the word 'collapse' stays in the button's aria-label for assistive tech", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      const btn = railButton();

      expect(container.textContent).not.toContain("▲");

      await user.click(btn);
      const hint = container.querySelector('[aria-hidden="true"]');
      expect(hint?.textContent).toBe("▲");
      expect(hint?.textContent).not.toMatch(/collapse/i);
      expect(btn).toHaveAttribute(
        "aria-label",
        expect.stringMatching(/collapse/i),
      );

      await user.click(btn);
      expect(container.textContent).not.toContain("▲");
    });

    it("un-pinning via click suppresses the CSS hover-preview immediately (data-suppress-hover), the pointer having never left", async () => {
      // Regression test: the rail's hover-preview grows it on `:hover` alone.
      // Clicking to un-pin while the pointer is still resting on the rail (the
      // common case, userEvent's virtual pointer stays put across clicks the
      // same as a real cursor) must not leave it visually stuck open. The
      // resulting DOM attribute is the CSS escape hatch; jsdom doesn't run
      // layout/paint so the visual collapse itself is covered by the browser
      // probe, not here.
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      const btn = railButton();

      await user.click(btn); // pin
      expect(btn).toHaveAttribute("data-suppress-hover", "false");

      await user.click(btn); // un-pin, pointer still over the button
      expect(btn).toHaveAttribute("data-pinned", "false");
      expect(btn).toHaveAttribute("data-suppress-hover", "true");
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it("clears the hover-preview suppression on the pointer's next genuine entry, not on its exit", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      inPanel(<PanelDelayRail />, store);
      const btn = railButton();

      await user.click(btn);
      await user.click(btn);
      expect(btn).toHaveAttribute("data-suppress-hover", "true");

      await user.unhover(btn);
      // Leaving does not clear it (that would race the same layout-only hover
      // loss a real browser exhibits here, see the rail's own doc comment);
      // only a fresh entry does.
      expect(btn).toHaveAttribute("data-suppress-hover", "true");

      await user.hover(btn);
      expect(btn).toHaveAttribute("data-suppress-hover", "false");
    });

    it("has no axe violations while pinned/grown", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      await user.click(railButton());
      await expectNoA11yViolations(container);
    });

    it("pinned with a stream AND a multi-command discrete handle grows every command", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register({
        id: "stream",
        inFlight: [],
        shape: "stream",
        effectiveDelaySeconds: 1.6,
        streams: [
          {
            id: "throttle",
            label: "Throttle",
            oneWaySeconds: 1.6,
            inTransit: [{ age: 0, value: 0.5 }],
            echo: [],
            current: 0.5,
          },
        ],
      });
      store.register({
        id: "discrete",
        inFlight: [
          { ...IN_FLIGHT[0], id: "d1", label: "SAS Prograde" },
          { ...IN_FLIGHT[0], id: "d2", label: "Stage" },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 3,
      });
      const { container } = inPanel(<PanelDelayRail />, store);
      await user.click(railButton());
      // Both discrete commands render as queue squares (plus the stream graph
      // above); their labels ride the squares' accessible names.
      const labels = Array.from(
        container.querySelectorAll('[role="listitem"][data-phase]'),
      ).map((t) => t.getAttribute("aria-label") ?? "");
      expect(labels.some((l) => l.includes("SAS Prograde"))).toBe(true);
      expect(labels.some((l) => l.includes("Stage"))).toBe(true);
    });
  });

  const refusal = (id: string) => ({
    id,
    errorCode: CommandErrorCode.AlreadyAtMaximum,
    command: "career.facility.upgrade",
    args: { facilityId: "LaunchPad" },
    breach: {
      facility: "LaunchPad",
      facilityName: "Launch Pad",
      facilityLevel: value("ratio", 1),
      quantity: "tier",
      limit: 3,
      actual: 3,
      unit: "count",
    },
  });

  function refusedHandle(
    id: string,
    count: number,
    dismiss?: (id: string) => void,
  ): CommandHandle {
    return {
      id,
      // Nothing in flight: a refusal is terminal, so it has already left the
      // pending queue. This is the case that used to render nothing at all.
      inFlight: [],
      shape: "discrete",
      effectiveDelaySeconds: 5,
      refusals: Array.from({ length: count }, (_, i) => refusal(`${id}-r${i}`)),
      dismiss,
    };
  }

  describe("a command the game refused", () => {
    it("mounts the rail for a handle carrying only refusals", () => {
      const store = createDelayRailStore();
      store.register(refusedHandle("cmd", 1));
      const { container } = inPanel(<PanelDelayRail />, store);
      expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
    });

    it("says how many failed in the collapsed strip, singular and plural", () => {
      const store = createDelayRailStore();
      store.register(refusedHandle("one", 1));
      const { unmount } = inPanel(<PanelDelayRail />, store);
      expect(screen.getByText("1 command failed")).toBeTruthy();
      unmount();

      const many = createDelayRailStore();
      many.register(refusedHandle("three", 3));
      inPanel(<PanelDelayRail />, many);
      expect(screen.getByText("3 commands failed")).toBeTruthy();
    });

    it("keeps the reason out of the collapsed strip and shows it once expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(refusedHandle("cmd", 1));
      inPanel(<PanelDelayRail />, store);

      const sentence =
        "Upgrade Launch Pad refused: it is already at tier 3 of 3.";
      // A hundred-character sentence cannot live in a 16px band.
      expect(screen.queryByText(sentence)).toBeNull();

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      expect(screen.getByText(sentence)).toBeTruthy();
      // And the count line gives way to the reason rather than doubling it.
      expect(screen.queryByText("1 command failed")).toBeNull();
    });

    it("clears a refusal through the handle that owns it", async () => {
      const user = userEvent.setup();
      const dismissed: string[] = [];
      const store = createDelayRailStore();
      store.register(refusedHandle("cmd", 1, (id) => dismissed.push(id)));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await user.click(
        screen.getByRole("button", { name: "Dismiss Upgrade Launch Pad" }),
      );
      expect(dismissed).toEqual(["cmd-r0"]);
    });

    it("has no axe violations collapsed or expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(refusedHandle("cmd", 2, () => {}));
      const { container } = inPanel(<PanelDelayRail />, store);
      await expectNoA11yViolations(container);
      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await expectNoA11yViolations(container);
    });

    it("says nothing failed for a handle that only has commands in flight", () => {
      // The negative. Without it the suite would pass just as well if the rail
      // called every command a failure.
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      inPanel(<PanelDelayRail />, store);
      expect(screen.queryByText(/command(s)? failed/)).toBeNull();
    });

    it("never reads a lost command as refused", async () => {
      // A lost command decided NOTHING and may well have executed. It belongs in
      // the queue as lost, and saying the game refused it would be a confident
      // wrong answer about something the game never said.
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register({
        id: "lost",
        inFlight: [
          {
            id: "l1",
            label: "Launch",
            command: "ksp.launch",
            reachEtaSeconds: null,
            replyEtaSeconds: null,
            predictedPhase: "lost",
          },
        ],
        shape: "discrete",
        effectiveDelaySeconds: 5,
      });
      inPanel(<PanelDelayRail />, store);
      expect(screen.queryByText(/command(s)? failed/)).toBeNull();
      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      expect(screen.queryByText(/refused/)).toBeNull();
      // It IS still shown, as what it is.
      expect(
        screen.getByRole("listitem", { name: /Launch, lost/ }),
      ).toBeTruthy();
    });
  });

  describe("a command nothing ever answered", () => {
    /**
     * The comms-loss drop: the engine drops a command for an unreachable
     * subject BEFORE it mints a pending-uplink entry, so there is nothing in
     * flight and no refusal, and this rail used to render zero pixels for the
     * command's entire life.
     */
    function droppedHandle(
      id: string,
      count: number,
      dismiss?: (id: string) => void,
    ): CommandHandle {
      return {
        id,
        inFlight: [],
        shape: "discrete",
        effectiveDelaySeconds: 5,
        losses: Array.from({ length: count }, (_, i) => ({
          id: `${id}-l${i}`,
          command: "vessel.control.setSas",
          args: { enabled: true },
          label: "",
        })),
        dismiss,
      };
    }

    it("mounts the rail for a handle carrying only losses", () => {
      const store = createDelayRailStore();
      store.register(droppedHandle("cmd", 1));
      const { container } = inPanel(<PanelDelayRail />, store);
      expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
    });

    it("counts a loss in the collapsed strip alongside a refusal", () => {
      const store = createDelayRailStore();
      store.register(droppedHandle("dropped", 1));
      store.register(refusedHandle("refused", 1));
      inPanel(<PanelDelayRail />, store);
      expect(screen.getByText("2 commands failed")).toBeTruthy();
    });

    it("says the command got no reply once expanded, and never that it worked", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(droppedHandle("cmd", 1));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("list", { name: /no reply/i });
      expect(list.textContent).toMatch(/no reply/i);
      // The one thing it must not do is claim the game said no: nothing was
      // decided, and the command may well have executed.
      expect(list.textContent).not.toMatch(/refused/i);
    });

    it("clears a loss through the handle that owns it", async () => {
      const user = userEvent.setup();
      const dismissed: string[] = [];
      const store = createDelayRailStore();
      store.register(droppedHandle("cmd", 1, (id) => dismissed.push(id)));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await user.click(
        screen.getByRole("button", { name: /Dismiss Set Sas/i }),
      );
      expect(dismissed).toEqual(["cmd-l0"]);
    });

    it("has no axe violations collapsed or expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(droppedHandle("cmd", 2, () => {}));
      const { container } = inPanel(<PanelDelayRail />, store);
      await expectNoA11yViolations(container);
      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await expectNoA11yViolations(container);
    });
  });

  describe("a lost command that answered after all", () => {
    /**
     * The other side of the comms-loss drop. `lost` says WE DO NOT KNOW, never
     * IT DID NOT HAPPEN: the correlation entry is retained and the transport
     * re-sends what it queued, so a command the operator was told to give up on
     * really can turn up executed.
     */
    function foundHandle(
      id: string,
      outcome: "ran" | "refused" | "errored",
      dismiss?: (id: string) => void,
    ): CommandHandle {
      return {
        id,
        inFlight: [],
        shape: "discrete",
        effectiveDelaySeconds: 5,
        founds: [
          {
            id: `${id}-f0`,
            command: "vessel.control.setSas",
            args: { enabled: true },
            label: "",
            outcome,
            ...(outcome === "refused"
              ? { errorCode: CommandErrorCode.WrongState }
              : {}),
            ...(outcome === "errored"
              ? { error: { code: "E_HANDLER", message: "the handler threw" } }
              : {}),
          },
        ],
        dismiss,
      };
    }

    it("mounts the rail for a handle carrying only founds", () => {
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran"));
      const { container } = inPanel(<PanelDelayRail />, store);
      expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
    });

    it("counts a found APART from the failures, in its own words", () => {
      // The count it must not join. A found is the one outcome that reverses a
      // failure, so folding it into "N commands failed" would file the good
      // news under the bad.
      const store = createDelayRailStore();
      store.register(foundHandle("found", "ran"));
      store.register({
        id: "dropped",
        inFlight: [],
        shape: "discrete",
        effectiveDelaySeconds: 5,
        losses: [
          {
            id: "dropped-l0",
            command: "vessel.control.setRcs",
            args: { enabled: true },
            label: "",
          },
        ],
      });
      inPanel(<PanelDelayRail />, store);
      expect(screen.getByText("1 command failed")).toBeTruthy();
      expect(screen.getByText("1 lost command found")).toBeTruthy();
    });

    it("announces the collapsed count politely, never assertively", () => {
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran"));
      inPanel(<PanelDelayRail />, store);
      const summary = screen.getByText("1 lost command found");
      expect(summary.getAttribute("role")).toBe("status");
      // Assertive is ABORT's, and this is news rather than an interruption.
      expect(summary.getAttribute("aria-live")).toBeNull();
    });

    it("says it was called lost and that it RAN, and never says confirmed", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("status", { name: /answered/i });
      expect(list.textContent).toMatch(/found .* after being lost/i);
      expect(list.textContent).toMatch(/found executed/i);
      // Confirmed means it worked as expected. Being told a command was lost
      // and then that it ran is the opposite of expected, and an operator who
      // re-sent it needs those to read differently.
      expect(list.textContent).not.toMatch(/confirmed/i);
    });

    it("keeps a late REFUSAL apart from a late success", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "refused"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("status", { name: /answered/i });
      expect(list.textContent).toMatch(/found .* after being lost/i);
      expect(list.textContent).toMatch(/found refused/i);
      expect(list.textContent).not.toMatch(/found executed/i);
    });

    it("says a late error reached the game, which a loss never could", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "errored"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("status", { name: /answered/i });
      expect(list.textContent).toMatch(/found errored/i);
      expect(list.textContent).toMatch(/the handler threw/i);
    });

    it("clears a found through the handle that owns it", async () => {
      const user = userEvent.setup();
      const dismissed: string[] = [];
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran", (id) => dismissed.push(id)));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await user.click(
        screen.getByRole("button", { name: /Dismiss Set Sas/i }),
      );
      expect(dismissed).toEqual(["cmd-f0"]);
    });

    it("has no axe violations collapsed or expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "refused", () => {}));
      const { container } = inPanel(<PanelDelayRail />, store);
      await expectNoA11yViolations(container);
      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await expectNoA11yViolations(container);
    });
  });

  it("drops --panel-rail-height back to the 0px fallback when the last command completes", () => {
    const store = createDelayRailStore();
    const deregister = store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    const rail = container.querySelector(
      "[data-panel-rail-frame]",
    ) as HTMLElement;
    drive(rail, 48);
    const target = targetOf(container);
    expect(target.style.getPropertyValue("--panel-rail-height")).toBe("48px");
    // Command completes: the rail unmounts and removes the var, so the panel
    // falls back to 0px.
    act(() => deregister());
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    expect(target.style.getPropertyValue("--panel-rail-height")).toBe("");
  });
});
