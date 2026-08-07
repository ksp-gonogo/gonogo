import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { Panel } from "./Panel";

/**
 * The compound Panel exists so that presentation is controlled centrally
 * rather than by 46 widgets. These tests pin the two properties that make that
 * true: the composition is exclusively named subcomponents, and the legacy
 * passthrough still works while widgets migrate.
 */
describe("Panel (compound)", () => {
  it("exposes every piece it composes", () => {
    // The governing principle: if Panel renders something not reachable here,
    // a widget needing a variant cannot reproduce it by hand.
    expect(Panel.Container).toBeDefined();
    expect(Panel.Title).toBeDefined();
    expect(Panel.Glow).toBeDefined();
    expect(Panel.Body).toBeDefined();
  });

  it("renders panelTitle from props", () => {
    render(
      <Panel panelTitle="ORBIT">
        <span>body</span>
      </Panel>,
    );
    expect(screen.getByRole("heading", { name: "ORBIT" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("passes children straight through when given no title or subtitle", () => {
    // The migration bridge. A widget still rendering its own PanelTitle keeps
    // today's unpadded behaviour, so widgets move one at a time and each
    // render change is attributable. Remove with the named exports.
    const { container } = render(
      <Panel>
        <span>legacy</span>
      </Panel>,
    );
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(container.querySelector("h3")).toBeNull();
  });

  it("accepts a className so styled(Panel) keeps working", () => {
    // Panel is a function component now; styled(Panel) silently produces an
    // unstyled panel if className is not forwarded.
    const { container } = render(<Panel className="probe" panelTitle="X" />);
    expect(container.querySelector(".probe")).not.toBeNull();
  });
});

describe("Panel.Glow coordination", () => {
  it("exposes the context provider it composes", () => {
    expect(Panel.Context).toBeDefined();
  });

  it("warns when it has no scroller to observe", () => {
    // Fail loudly, not silently. Outside a Panel.Context the glow renders
    // perfectly and does nothing, which is exactly how the previous glow bug
    // (an invalid unitless zero in a calc) survived unnoticed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Panel.Glow />);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Panel.Glow rendered outside a Panel.Context"),
    );
    warn.mockRestore();
  });

  it("stays quiet when composed inside a Panel", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Panel panelTitle="X">body</Panel>);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
