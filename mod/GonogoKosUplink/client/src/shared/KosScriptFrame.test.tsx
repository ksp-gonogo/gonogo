import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { KosScriptFrame } from "./KosScriptFrame";

const baseProps = {
  title: "Test",
  running: false,
  scriptError: null,
  parseError: null,
  lastGoodAt: null,
  children: <div>body</div>,
};

describe("KosScriptFrame paused state", () => {
  it("renders a Paused banner with reason and a Re-enable button when paused", () => {
    const onReEnable = vi.fn();
    render(
      <KosScriptFrame
        {...baseProps}
        paused
        pausedReason="Undefined Variable Name 'needswrite'"
        onReEnable={onReEnable}
      />,
    );
    expect(screen.getByText(/Paused — kOS errors/i)).toBeInTheDocument();
    expect(screen.getByText(/needswrite/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Re-enable/i }),
    ).toBeInTheDocument();
  });

  it("hides the regular error banner while paused — they'd otherwise duplicate", () => {
    render(
      <KosScriptFrame
        {...baseProps}
        scriptError={new Error("kos error")}
        paused
        pausedReason="kos error"
        onReEnable={() => {}}
      />,
    );
    expect(screen.queryByText(/Script failed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Paused — kOS errors/i)).toBeInTheDocument();
  });

  it("clicking Re-enable invokes the callback", async () => {
    const onReEnable = vi.fn();
    const user = userEvent.setup();
    render(
      <KosScriptFrame
        {...baseProps}
        paused
        pausedReason="boom"
        onReEnable={onReEnable}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Re-enable/i }));
    expect(onReEnable).toHaveBeenCalledTimes(1);
  });

  it("does not render the Paused banner when paused is false", () => {
    render(
      <KosScriptFrame {...baseProps} scriptError={new Error("transient")} />,
    );
    expect(screen.queryByText(/Paused — kOS errors/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Script failed/i)).toBeInTheDocument();
  });

  it("has no accessible violations", async () => {
    const { container } = render(
      <KosScriptFrame
        {...baseProps}
        paused
        pausedReason="Undefined Variable Name 'needswrite'"
        onReEnable={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
