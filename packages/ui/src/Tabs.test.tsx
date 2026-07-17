import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

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

  it("uses a roving tabindex — only the active tab is Tab-reachable", () => {
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
