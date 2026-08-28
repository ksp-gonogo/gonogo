import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel, PanelTitle } from "./Panel";
import { fittedTitleIndex } from "./useFittedTitle";

/**
 * The hysteresis, tested without a DOM because it is the half that decides.
 * The measurement itself needs a browser and is covered by the min-size gate,
 * which mounts every widget in Chromium.
 */
describe("fittedTitleIndex", () => {
  const widths = [130, 90, 55];

  it("keeps the full title when it fits", () => {
    expect(fittedTitleIndex(0, 200, widths)).toBe(0);
  });

  it("steps to the longest form that fits", () => {
    expect(fittedTitleIndex(0, 110, widths)).toBe(1);
    expect(fittedTitleIndex(0, 60, widths)).toBe(2);
  });

  it("takes the shortest form when even that does not fit", () => {
    expect(fittedTitleIndex(0, 20, widths)).toBe(2);
  });

  /**
   * The oscillation this hook was rewritten to close. Once compacted, the box
   * has exactly the room the SHORT form needs, so a longer form that would fit
   * "at" the available width is a form that stops fitting the moment it is
   * shown.
   */
  it("does not step back up without room to spare", () => {
    expect(fittedTitleIndex(1, 130, widths)).toBe(1);
    expect(fittedTitleIndex(1, 145, widths)).toBe(0);
  });

  /**
   * jsdom lays nothing out, so every width is zero, and a hook that shortened
   * on that would make every `getByText` in the tree depend on layout no test
   * can see.
   */
  it("holds the full title when nothing has been measured", () => {
    expect(fittedTitleIndex(1, 0, widths)).toBe(0);
    expect(fittedTitleIndex(1, 200, [0, 0, 0])).toBe(0);
  });
});

describe("PanelTitle compact", () => {
  it("renders the full title where nothing has been measured", () => {
    render(<PanelTitle compact={["RES OPS", "RES"]}>RESOURCE OPS</PanelTitle>);
    expect(screen.getByRole("heading")).toHaveTextContent("RESOURCE OPS");
  });

  it("carries no accessible-name override while the full title is showing", () => {
    render(<PanelTitle compact="KSC">SPACE CENTER</PanelTitle>);
    expect(screen.getByRole("heading")).not.toHaveAttribute("aria-label");
  });

  it("takes the same forms through Panel's own prop", () => {
    render(
      <Panel panelTitle="PROGRAMME FUNDING" compactTitle={["FUNDING", "FUND"]}>
        body
      </Panel>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("PROGRAMME FUNDING");
  });

  it("leaves a title that is markup alone", () => {
    render(
      <PanelTitle compact={["SHORT"]}>
        <span>MARKED UP</span>
      </PanelTitle>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("MARKED UP");
  });
});
