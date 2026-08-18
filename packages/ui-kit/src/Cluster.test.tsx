import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Cluster } from "./Cluster";
import { render, screen } from "./testing-react";

describe("Cluster", () => {
  it("renders its children", () => {
    render(
      <Cluster>
        <span>a</span>
        <span>b</span>
      </Cluster>,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("forwards a ref to its root div (so widgets can measure it)", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Cluster ref={ref} data-testid="c">
        x
      </Cluster>,
    );
    expect(ref.current).toBe(screen.getByTestId("c"));
    expect(ref.current?.tagName).toBe("DIV");
  });
});
