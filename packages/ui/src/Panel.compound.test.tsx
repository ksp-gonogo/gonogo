import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { Panel } from "./Panel";

/** Panel composition is exclusively named subcomponents, and a widget drawing its own heading keeps the unpadded passthrough. */
describe("Panel (compound)", () => {
  it("exposes every piece it composes", () => {
    // Anything Panel renders must be reachable here, or a widget needing a variant cannot reproduce it.
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
    const { container } = render(
      <Panel>
        <span>legacy</span>
      </Panel>,
    );
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(container.querySelector("h3")).toBeNull();
  });

  it("accepts a className so styled(Panel) keeps working", () => {
    // styled(Panel) silently produces an unstyled panel if className is not forwarded.
    const { container } = render(<Panel className="probe" panelTitle="X" />);
    expect(container.querySelector(".probe")).not.toBeNull();
  });
});

describe("Panel.Glow coordination", () => {
  it("exposes the context provider it composes", () => {
    expect(Panel.Context).toBeDefined();
  });

  it("warns when it has no scroller to observe", () => {
    // Outside a Panel.Context the glow renders but does nothing, so it must warn.
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
