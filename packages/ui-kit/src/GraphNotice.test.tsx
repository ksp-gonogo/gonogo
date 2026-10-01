import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { GraphNotice, placeGraphNotice } from "./GraphNotice";

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

describe("placeGraphNotice", () => {
  const roomy = { width: 400, height: 240 };

  it("centres the notice over an empty plot that has room", () => {
    expect(placeGraphNotice({ ...roomy, plotHasData: false })).toBe("center");
  });

  it("never overlays a plot that draws something", () => {
    expect(placeGraphNotice({ ...roomy, plotHasData: true })).toBe("inline");
  });

  it("goes below an empty plot too small to hold the pill", () => {
    expect(
      placeGraphNotice({ width: 120, height: 60, plotHasData: false }),
    ).toBe("inline");
  });

  it("goes beside a wide, short graph", () => {
    expect(
      placeGraphNotice({ width: 640, height: 120, plotHasData: true }),
    ).toBe("beside");
  });

  it("goes below when the wide graph is too narrow for a side column", () => {
    expect(
      placeGraphNotice({ width: 300, height: 90, plotHasData: true }),
    ).toBe("inline");
  });

  it("sits as a column when placement is beside", () => {
    render(
      <GraphNotice placement="beside" data-testid="notice">
        beside notice
      </GraphNotice>,
    );
    expect(screen.getByTestId("notice")).not.toHaveStyle({
      position: "absolute",
    });
  });
});

describe("GraphNotice centre placement", () => {
  it("pins to the middle of its positioned ancestor", () => {
    render(
      <GraphNotice placement="center" data-testid="notice">
        centred notice
      </GraphNotice>,
    );
    expect(screen.getByTestId("notice")).toHaveStyle({
      position: "absolute",
      top: "50%",
      left: "50%",
    });
  });
});
