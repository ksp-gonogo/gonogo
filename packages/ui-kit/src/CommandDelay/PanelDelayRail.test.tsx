import {
  CommandErrorCode,
  railTagsForCommand,
  railTagsForControlAxis,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { emittedRuleFor } from "../test/emittedRule";
import {
  type CommandHandle,
  createDelayRailStore,
  DelayRailContext,
} from "./DelayRailContext";
import { PanelDelayRail } from "./PanelDelayRail";
import type { InFlightCommandLike } from "./toInFlightListItems";

// The rail axes come from the production derivations, so the fixtures follow them rather than asserting stale literals.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");
const RAIL_CONTINUOUS = railTagsForControlAxis("vessel.control.setAxes");

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
    tags: RAIL_DISCRETE,
    effectiveDelaySeconds: 5,
  };
}

/** The rail's off-screen announcer, a bare `aria-live` region. */
function railAnnouncer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-live-region]");
}

/** The rail with a store above it, which is all it needs. */
function inPanel(rail: JSX.Element, store = createDelayRailStore()) {
  return render(
    <DelayRailContext.Provider value={store}>{rail}</DelayRailContext.Provider>,
  );
}

describe("PanelDelayRail", () => {
  it("renders the delay UI for an active handle in context", () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    // The rail renders a discrete handle as the glow-band strip, not the monospace list.
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

  it("announces an outcome that arrives after the command registered, in a region that was already there", () => {
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    inPanel(<PanelDelayRail />, store);
    const announcer = railAnnouncer();
    expect(announcer).toBeEmptyDOMElement();

    act(() => {
      store.update("cmd", {
        ...handle("cmd"),
        inFlight: [],
        losses: [{ id: "cmd-l0", command: "vessel.control.setRcs", label: "" }],
      });
    });

    expect(railAnnouncer()).toBe(announcer);
    expect(announcer).toHaveTextContent(/no reply\. May have run\./);
    expect(announcer).toHaveAttribute("aria-atomic", "false");
  });

  it("gives a widget that commands nothing no announcer", () => {
    inPanel(<PanelDelayRail />);
    expect(railAnnouncer()).toBeNull();
  });

  it("does not tell assistive tech the rail expanded when a hover only previews it", async () => {
    const user = userEvent.setup();
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    inPanel(<PanelDelayRail />, store);
    const btn = screen.getByRole("button", { name: /signal-delay detail/i });
    await user.hover(btn);
    expect(btn).toHaveAttribute("data-grown", "true");
    expect(btn).not.toHaveAttribute("aria-expanded");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("has no axe violations grown with a command in flight", async () => {
    const user = userEvent.setup();
    const store = createDelayRailStore();
    store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    await user.click(
      screen.getByRole("button", { name: /signal-delay detail/i }),
    );
    expect(
      screen.getByRole("button", { name: /signal-delay detail/i }),
    ).toHaveAttribute("data-grown", "true");
    await expectNoA11yViolations(container);
  });

  it("renders no rail chrome when no handles are active (the band stands empty)", () => {
    const { container } = inPanel(<PanelDelayRail />);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    expect(
      container.querySelector('[aria-label="In-flight commands"]'),
    ).toBeNull();
  });

  it("renders nothing for a registered but idle/instant handle (empty inFlight, nothing to draw)", () => {
    // An idle command registers but its CommandDelay would draw nothing, so the rail stays absent.
    const store = createDelayRailStore();
    store.register({
      id: "instant",
      inFlight: [],
      tags: RAIL_DISCRETE,
      effectiveDelaySeconds: 0,
    });
    const { container } = inPanel(<PanelDelayRail />, store);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
  });

  it("renders nothing for a delayed stream handle with no buffers to draw", () => {
    // A stream-shaped command with no `streams` draws nothing, so the rail must not mount around it.
    const store = createDelayRailStore();
    store.register({
      id: "bufferless-stream",
      inFlight: [],
      tags: RAIL_CONTINUOUS,
      effectiveDelaySeconds: 1.6,
    });
    const { container } = inPanel(<PanelDelayRail />, store);
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
  });

  /*
   * The band is the widget's, not the traffic's. jsdom runs no layout, so the
   * reservation is pinned structurally: the box is there with no chrome in it,
   * in normal flow, pulled up into the container's inset by exactly the band.
   */
  describe("the band is reserved, not taken", () => {
    function railButton(): HTMLButtonElement {
      return screen.getByRole("button", {
        name: /signal-delay detail/i,
      }) as HTMLButtonElement;
    }

    it("stands the band up for a widget with nothing in flight at all", () => {
      const { container } = inPanel(<PanelDelayRail />);
      // The band with no rail chrome inside it.
      expect(container.querySelector("[data-panel-rail-frame]")).not.toBeNull();
      expect(container.querySelector("[data-panel-rail]")).toBeNull();
    });

    it("costs the panel nothing collapsed: it pulls up into the container's inset by exactly the band", () => {
      const { container } = inPanel(<PanelDelayRail />);
      const frame = container.querySelector(
        "[data-panel-rail-frame]",
      ) as HTMLElement;
      const style = getComputedStyle(frame);
      // Reserved, not taken: the box is the band tall and sits in room the container already made.
      expect(style.minHeight).toContain("--panel-rail-band");
      expect(style.marginTop).toContain("--panel-rail-band");
    });

    it("keeps the collapsed rail in normal flow inside that band, covering nothing", () => {
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      inPanel(<PanelDelayRail />, store);
      // Not `absolute`: an out-of-flow band would draw over the sticky header and take its clicks.
      expect(getComputedStyle(railButton()).position).toBe("relative");
    });
  });

  describe("pin-to-grow (v4)", () => {
    function railButton(): HTMLButtonElement {
      return screen.getByRole("button", {
        name: /signal-delay detail/i,
      }) as HTMLButtonElement;
    }

    it("is a toggle button, unpressed by default, showing the rail summary not the detail list", () => {
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      const { container } = inPanel(<PanelDelayRail />, store);
      const btn = railButton();
      expect(btn).toHaveAttribute("aria-pressed", "false");
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
      // Grown: the queue square replaces the glow in place, inside the rail button.
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
      // Un-pinning with the pointer still resting on the rail must not leave it stuck open; jsdom sees only the attribute.
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
      // Only a fresh entry clears it, never leaving.
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
        tags: RAIL_CONTINUOUS,
        effectiveDelaySeconds: 1.6,
        streams: [
          {
            id: "throttle",
            label: "Throttle",
            oneWaySeconds: 1.6,
            inTransit: [{ age: 0, value: 0.5 }],
            echo: [],
            current: 0.5,
            tags: RAIL_CONTINUOUS,
          },
        ],
      });
      store.register({
        id: "discrete",
        inFlight: [
          { ...IN_FLIGHT[0], id: "d1", label: "SAS Prograde" },
          { ...IN_FLIGHT[0], id: "d2", label: "Stage" },
        ],
        tags: RAIL_DISCRETE,
        effectiveDelaySeconds: 3,
      });
      const { container } = inPanel(<PanelDelayRail />, store);
      await user.click(railButton());
      // Both discrete commands render as queue squares, labels on their accessible names.
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
      // Nothing in flight: a refusal is terminal.
      inFlight: [],
      tags: RAIL_DISCRETE,
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

    it("draws the count in the warning colour made for text on the panel, not the one made for text on amber", () => {
      const store = createDelayRailStore();
      store.register(refusedHandle("one", 1));
      inPanel(<PanelDelayRail />, store);
      const rule = emittedRuleFor(screen.getByText("1 command failed"));
      expect(rule).toContain("var(--color-status-warning-fg-muted)");
    });

    it("keeps the reason out of the collapsed strip and shows it once expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(refusedHandle("cmd", 1));
      inPanel(<PanelDelayRail />, store);

      const sentence =
        "Upgrade Launch Pad refused: it is already at tier 3 of 3.";
      // The sentence cannot fit the band; the off-screen announcer carries it.
      const drawn = { ignore: "script, style, [data-live-region] *" };
      expect(screen.queryByText(sentence, drawn)).toBeNull();

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      expect(screen.getByText(sentence, drawn)).toBeTruthy();
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
      // The negative, so the suite fails if every command were called a failure.
      const store = createDelayRailStore();
      store.register(handle("cmd"));
      inPanel(<PanelDelayRail />, store);
      expect(screen.queryByText(/command(s)? failed/)).toBeNull();
    });

    it("never reads a lost command as refused", async () => {
      // A lost command may have executed; the game never refused it.
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
        tags: RAIL_DISCRETE,
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
    // The comms-loss drop happens before a pending entry exists, so there is nothing in flight and no refusal.
    function droppedHandle(
      id: string,
      count: number,
      dismiss?: (id: string) => void,
    ): CommandHandle {
      return {
        id,
        inFlight: [],
        tags: RAIL_DISCRETE,
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
      // Never "refused": nothing was decided, and the command may have executed.
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
    // `lost` means unknown, not did-not-happen: the transport re-sends, so the command can turn up executed.
    function foundHandle(
      id: string,
      outcome: "ran" | "refused" | "errored",
      dismiss?: (id: string) => void,
    ): CommandHandle {
      return {
        id,
        inFlight: [],
        tags: RAIL_DISCRETE,
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
      // A found reverses a failure, so it never joins the failure count.
      const store = createDelayRailStore();
      store.register(foundHandle("found", "ran"));
      store.register({
        id: "dropped",
        inFlight: [],
        tags: RAIL_DISCRETE,
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

    it("announces a found politely, never assertively", () => {
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran"));
      inPanel(<PanelDelayRail />, store);
      const announcer = railAnnouncer();
      expect(announcer).toHaveTextContent(/found executed/i);
      // Polite: assertive is reserved for ABORT.
      expect(announcer).toHaveAttribute("aria-live", "polite");
    });

    it("says it was called lost and that it RAN, and never says confirmed", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "ran"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("list", { name: /answered/i });
      expect(list.textContent).toMatch(/found executed/i);
      // Not "confirmed": an operator who re-sent it needs the two to read differently.
      expect(list.textContent).not.toMatch(/confirmed/i);
    });

    it("keeps a late REFUSAL apart from a late success", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "refused"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("list", { name: /answered/i });
      expect(list.textContent).toMatch(/found refused/i);
      expect(list.textContent).not.toMatch(/found executed/i);
    });

    it("says a late error reached the game, which a loss never could", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(foundHandle("cmd", "errored"));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("list", { name: /answered/i });
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

  describe("a command that never left this machine", () => {
    // The other way a loss ends: the transport gave up, so the rail can say the command did not run.
    function unsentHandle(
      id: string,
      count: number,
      dismiss?: (id: string) => void,
    ): CommandHandle {
      return {
        id,
        inFlight: [],
        tags: RAIL_DISCRETE,
        effectiveDelaySeconds: 5,
        undelivered: Array.from({ length: count }, (_, i) => ({
          id: `${id}-u${i}`,
          command: "vessel.control.setSas",
          args: { enabled: true },
          label: "",
        })),
        dismiss,
      };
    }

    it("mounts the rail for a handle carrying only undelivered commands", () => {
      const store = createDelayRailStore();
      store.register(unsentHandle("cmd", 1));
      const { container } = inPanel(<PanelDelayRail />, store);
      expect(container.querySelector("[data-panel-rail]")).not.toBeNull();
    });

    it("counts WITH the failures, so promoting a loss does not drop the count", () => {
      // Counted with the failures, since it confirms one.
      const store = createDelayRailStore();
      store.register(unsentHandle("unsent", 1));
      store.register(refusedHandle("refused", 1));
      inPanel(<PanelDelayRail />, store);
      expect(screen.getByText("2 commands failed")).toBeTruthy();
      expect(screen.queryByText(/found/)).toBeNull();
    });

    it("says it never left and that a re-send is safe, once expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(unsentHandle("cmd", 1));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      const list = screen.getByRole("list", { name: /never sent/i });
      expect(list.textContent).toMatch(/never sent/i);
      expect(list.textContent).toMatch(/safe to re-send/i);
      // No doubt carried over from the loss: this command provably did not run.
      expect(list.textContent).not.toMatch(/unknown/i);
    });

    it("clears an undelivered command through the handle that owns it", async () => {
      const user = userEvent.setup();
      const dismissed: string[] = [];
      const store = createDelayRailStore();
      store.register(unsentHandle("cmd", 1, (id) => dismissed.push(id)));
      inPanel(<PanelDelayRail />, store);

      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await user.click(
        screen.getByRole("button", { name: /Dismiss Set Sas/i }),
      );
      expect(dismissed).toEqual(["cmd-u0"]);
    });

    it("has no axe violations collapsed or expanded", async () => {
      const user = userEvent.setup();
      const store = createDelayRailStore();
      store.register(unsentHandle("cmd", 2, () => {}));
      const { container } = inPanel(<PanelDelayRail />, store);
      await expectNoA11yViolations(container);
      await user.click(screen.getByRole("button", { name: /Signal-delay/ }));
      await expectNoA11yViolations(container);
    });
  });

  it("keeps the band when the last command completes under an open rail, and gives the detail back", async () => {
    const user = userEvent.setup();
    const store = createDelayRailStore();
    const deregister = store.register(handle("cmd"));
    const { container } = inPanel(<PanelDelayRail />, store);
    await user.click(
      screen.getByRole("button", { name: /signal-delay detail/i }),
    );
    expect(container.querySelector('[aria-label*="Launch"]')).not.toBeNull();
    // The rail chrome goes when the command completes; the band stays.
    act(() => deregister());
    expect(container.querySelector("[data-panel-rail]")).toBeNull();
    expect(container.querySelector("[data-panel-rail-frame]")).not.toBeNull();
  });
});
