import { describe, expect, it } from "vitest";
import { Fill } from "./Fill";
import { render, screen } from "./testing-react";

describe("Fill", () => {
  it("renders its children", () => {
    render(
      <Fill>
        <span>Ascent trace</span>
      </Fill>,
    );
    expect(screen.getByText("Ascent trace")).toBeInTheDocument();
  });

  it("fills its parent by default (height/width 100%, no flex-grow)", () => {
    render(<Fill data-testid="fill">content</Fill>);
    expect(screen.getByTestId("fill")).toHaveStyle({
      position: "relative",
      height: "100%",
      width: "100%",
    });
  });

  it("grows to fill a flex parent instead when grow is set", () => {
    render(
      <Fill grow data-testid="fill">
        content
      </Fill>,
    );
    expect(screen.getByTestId("fill")).toHaveStyle({
      flex: "1 1 auto",
    });
  });

  it("forwards arbitrary div attributes", () => {
    render(
      <Fill aria-label="graph frame" data-testid="fill">
        content
      </Fill>,
    );
    expect(screen.getByTestId("fill")).toHaveAttribute(
      "aria-label",
      "graph frame",
    );
  });
});
