import { describe, expect, it } from "vitest";
import { GraphNotice } from "./GraphNotice";
import { render, screen } from "./testing-react";

describe("GraphNotice", () => {
  it("renders its children with an implicit status role", () => {
    render(
      <GraphNotice placement="overlay">
        No reference data for Mun: plotting trace only.
      </GraphNotice>,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(
      "No reference data for Mun: plotting trace only.",
    );
  });

  it("positions absolutely when placement is overlay", () => {
    render(
      <GraphNotice placement="overlay" data-testid="notice">
        overlay notice
      </GraphNotice>,
    );
    expect(screen.getByTestId("notice")).toHaveStyle({
      position: "absolute",
    });
  });

  it("sits in normal flow when placement is inline", () => {
    render(
      <GraphNotice placement="inline" data-testid="notice">
        inline notice
      </GraphNotice>,
    );
    const notice = screen.getByTestId("notice");
    expect(notice).toHaveStyle({ alignSelf: "flex-start" });
    expect(notice).not.toHaveStyle({ position: "absolute" });
  });

  it("is pointer-events:none so it never intercepts graph clicks", () => {
    render(
      <GraphNotice placement="overlay" data-testid="notice">
        notice
      </GraphNotice>,
    );
    expect(screen.getByTestId("notice")).toHaveStyle({
      pointerEvents: "none",
    });
  });

  it("allows the role to be overridden", () => {
    render(
      <GraphNotice placement="inline" role="note">
        overridden role
      </GraphNotice>,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
