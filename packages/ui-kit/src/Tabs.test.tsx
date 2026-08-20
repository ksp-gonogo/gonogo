import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldExpandTabs, TABS_PANEL_MIN_WIDTH, Tabs } from "./Tabs";
import { axe } from "./test/axe";

const TABS = [
  { id: "one", label: "One", content: <span>panel-one</span> },
  { id: "two", label: "Two", content: <span>panel-two</span> },
];

describe("Tabs", () => {
  it("renders the active panel and marks its tab selected", () => {
    render(<Tabs tabs={TABS} activeId="one" onChange={() => undefined} />);
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("panel-one")).toBeInTheDocument();
    expect(screen.queryByText("panel-two")).not.toBeInTheDocument();
  });

  it("calls onChange when a different tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="one" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("switches the visible panel when activeId changes", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("one");
      return <Tabs tabs={TABS} activeId={active} onChange={setActive} />;
    }
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("panel-two")).toBeInTheDocument();
    expect(screen.queryByText("panel-one")).not.toBeInTheDocument();
  });

  it("falls back to the first tab when activeId does not match", () => {
    render(<Tabs tabs={TABS} activeId="missing" onChange={() => undefined} />);
    expect(screen.getByText("panel-one")).toBeInTheDocument();
  });

  it("manages its own selection when activeId/onChange are omitted", async () => {
    const user = userEvent.setup();
    render(<Tabs tabs={TABS} />);
    expect(screen.getByText("panel-one")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("panel-two")).toBeInTheDocument();
  });

  it("accepts bare { label, content } pairs with no id", () => {
    render(
      <Tabs
        tabs={[
          { label: "Alpha", content: <span>alpha-panel</span> },
          { label: "Beta", content: <span>beta-panel</span> },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("alpha-panel")).toBeInTheDocument();
  });

  it("uses a roving tabindex, only the active tab is Tab-reachable", () => {
    render(<Tabs tabs={TABS} activeId="one" onChange={() => undefined} />);
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("ArrowRight from the last tab wraps to the first", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("two");
      return <Tabs tabs={TABS} activeId={active} onChange={setActive} />;
    }
    render(<Harness />);
    const last = screen.getByRole("tab", { name: "Two" });
    last.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
  });

  it("ArrowLeft from the first tab wraps to the last", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("one");
      return <Tabs tabs={TABS} activeId={active} onChange={setActive} />;
    }
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "One" });
    first.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
  });

  it("ArrowDown/ArrowUp move between tabs the same as ArrowRight/ArrowLeft", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("one");
      return <Tabs tabs={TABS} activeId={active} onChange={setActive} />;
    }
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "One" });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
  });

  it("Home and End jump to the first and last tabs", async () => {
    const user = userEvent.setup();
    const THREE = [
      ...TABS,
      { id: "three", label: "Three", content: <span>panel-three</span> },
    ];
    function Harness() {
      const [active, setActive] = useState("two");
      return <Tabs tabs={THREE} activeId={active} onChange={setActive} />;
    }
    render(<Harness />);
    const middle = screen.getByRole("tab", { name: "Two" });
    middle.focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
  });
});

describe("Tabs disabled", () => {
  const DISABLED_FIRST = [
    {
      id: "one",
      label: "One",
      content: <span>panel-one</span>,
      disabled: true,
    },
    { id: "two", label: "Two", content: <span>panel-two</span> },
    { id: "three", label: "Three", content: <span>panel-three</span> },
  ];

  it("cannot be selected by pointer", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={DISABLED_FIRST} activeId="two" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: "One" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("panel-two")).toBeInTheDocument();
  });

  it("shows the panel of the first tab that applies when the active one turns off", () => {
    // The case this exists for: a tab whose subsystem goes away while it is
    // open. Rendering its (now meaningless) panel, or nothing at all, both
    // strand the operator; the next applicable tab is what they wanted.
    render(
      <Tabs tabs={DISABLED_FIRST} activeId="one" onChange={() => undefined} />,
    );
    expect(screen.getByText("panel-two")).toBeInTheDocument();
    expect(screen.queryByText("panel-one")).not.toBeInTheDocument();
  });

  it("is stepped over by the roving arrow navigation, in both directions", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("two");
      return (
        <Tabs tabs={DISABLED_FIRST} activeId={active} onChange={setActive} />
      );
    }
    render(<Harness />);
    screen.getByRole("tab", { name: "Two" }).focus();
    // Left from Two would land on the disabled One, so it wraps past it.
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Three" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
  });

  it("Home lands on the first tab that applies, not the first tab", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState("three");
      return (
        <Tabs tabs={DISABLED_FIRST} activeId={active} onChange={setActive} />
      );
    }
    render(<Harness />);
    screen.getByRole("tab", { name: "Three" }).focus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Tabs tabs={DISABLED_FIRST} activeId="two" onChange={() => undefined} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("shouldExpandTabs", () => {
  it("never expands a single tab", () => {
    expect(shouldExpandTabs(10_000, 1)).toBe(false);
  });

  it("stays collapsed below an unmeasured (0) width", () => {
    expect(shouldExpandTabs(0, 2)).toBe(false);
  });

  it("collapses when the container can't fit every panel at its minimum width", () => {
    const tooNarrow = TABS_PANEL_MIN_WIDTH * 2 - 1;
    expect(shouldExpandTabs(tooNarrow, 2)).toBe(false);
  });

  it("expands once the container can fit every panel side by side", () => {
    const justEnough = TABS_PANEL_MIN_WIDTH * 2 + 8;
    expect(shouldExpandTabs(justEnough, 2)).toBe(true);
  });
});

/**
 * jsdom's global `ResizeObserver` stub never fires, so `useElementSize`
 * reports the seed `{ w: 0, h: 0 }` for the lifetime of a test. This double
 * records what it observes and lets a test hand a specific width to the
 * `Tabs` root, exercising the `expandWhenRoomy` render path end to end
 * (mirrors `Panel.sidebar.test.tsx`'s `DrivableResizeObserver`).
 */
type Entry = {
  target: Element;
  contentRect: { width: number; height: number };
};

class DrivableResizeObserver {
  static instances: DrivableResizeObserver[] = [];
  readonly observed = new Set<Element>();
  readonly callback: (entries: Entry[]) => void;
  constructor(callback: (entries: Entry[]) => void) {
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

function tabsRoot(): Element {
  return document.querySelector("[data-tabs-root]") as Element;
}

function resizeTo(el: Element, width: number) {
  act(() => {
    for (const ro of DrivableResizeObserver.instances) {
      if (!ro.observed.has(el)) continue;
      ro.callback([{ target: el, contentRect: { width, height: 100 } }]);
    }
  });
}

describe("Tabs expandWhenRoomy", () => {
  const realResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    DrivableResizeObserver.instances = [];
    globalThis.ResizeObserver =
      DrivableResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  it("stays in switch mode (one panel, a tablist) when narrow", () => {
    render(
      <Tabs
        tabs={TABS}
        activeId="one"
        onChange={() => undefined}
        expandWhenRoomy
      />,
    );
    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByText("panel-one")).toBeInTheDocument();
    expect(screen.queryByText("panel-two")).not.toBeInTheDocument();
  });

  it("shows every panel side by side, each labelled, once the container is wide enough", () => {
    render(
      <Tabs
        tabs={TABS}
        activeId="one"
        onChange={() => undefined}
        expandWhenRoomy
      />,
    );
    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH * 2 + 8);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Two" })).toBeInTheDocument();
    expect(screen.getByText("panel-one")).toBeInTheDocument();
    expect(screen.getByText("panel-two")).toBeInTheDocument();
  });

  it("does not expand when expandWhenRoomy is false, even with room to spare", () => {
    render(<Tabs tabs={TABS} activeId="one" onChange={() => undefined} />);
    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH * 2 + 8);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByText("panel-two")).not.toBeInTheDocument();
  });

  it("collapses back to switch mode when the container narrows again", () => {
    render(
      <Tabs
        tabs={TABS}
        activeId="one"
        onChange={() => undefined}
        expandWhenRoomy
      />,
    );
    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH * 2 + 8);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByText("panel-two")).not.toBeInTheDocument();
  });

  it("names the tab strip when asked, and leaves it unnamed when not", () => {
    const { rerender } = render(
      <Tabs tabs={TABS} activeId="one" onChange={() => undefined} />,
    );
    // Unnamed is the default and stays that way: a name nobody asked for would
    // be one more thing read aloud on every screen that has only one strip.
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-label");

    rerender(
      <Tabs
        tabs={TABS}
        activeId="one"
        onChange={() => undefined}
        aria-label="Trigger kind"
      />,
    );
    expect(screen.getByRole("tablist", { name: "Trigger kind" })).toBeTruthy();
  });

  it("takes the name from another element with aria-labelledby", () => {
    render(
      <>
        <h2 id="strip-heading">Mission phase</h2>
        <Tabs
          tabs={TABS}
          activeId="one"
          onChange={() => undefined}
          aria-labelledby="strip-heading"
        />
      </>,
    );
    expect(screen.getByRole("tablist", { name: "Mission phase" })).toBeTruthy();
  });

  it("has no axe violations when expanded side by side", async () => {
    const { container } = render(
      <Tabs
        tabs={TABS}
        activeId="one"
        onChange={() => undefined}
        expandWhenRoomy
      />,
    );
    resizeTo(tabsRoot(), TABS_PANEL_MIN_WIDTH * 2 + 8);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
