import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "./test/axe";
import { WidgetHeader } from "./WidgetHeader";

describe("WidgetHeader", () => {
  it("renders the title slot", () => {
    render(<WidgetHeader title="Telemetry" />);
    expect(screen.getByText("Telemetry")).toBeInTheDocument();
  });

  it("renders children when no title is provided", () => {
    render(
      <WidgetHeader>
        <span>Children title</span>
      </WidgetHeader>,
    );
    expect(screen.getByText("Children title")).toBeInTheDocument();
  });

  it("renders the actions slot", () => {
    render(
      <WidgetHeader
        title="Stage 1"
        actions={
          <button type="button" aria-label="settings">
            settings
          </button>
        }
      />,
    );
    expect(
      screen.getByRole("button", { name: "settings" }),
    ).toBeInTheDocument();
  });

  it("prefers title over children when both are passed", () => {
    render(
      <WidgetHeader title="Title wins">
        <span>Children lose</span>
      </WidgetHeader>,
    );
    expect(screen.getByText("Title wins")).toBeInTheDocument();
    expect(screen.queryByText("Children lose")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <WidgetHeader
        title="Mission clock"
        actions={
          <button type="button" aria-label="reset clock">
            reset
          </button>
        }
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
