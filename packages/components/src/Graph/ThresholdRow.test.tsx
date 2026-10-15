import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { SeriesRow } from "./SeriesRow";
import { ThresholdRow } from "./ThresholdRow";

describe("ThresholdRow", () => {
  const line = { id: "t1", value: 5, axis: "primary" as const, label: "Cap" };

  it("reports a cleared value as absent rather than NaN", () => {
    const onUpdate = vi.fn();
    render(
      <ThresholdRow threshold={line} onUpdate={onUpdate} onRemove={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith("t1", { value: undefined });
  });

  it("names its remove button after the line", () => {
    const onRemove = vi.fn();
    render(
      <ThresholdRow threshold={line} onUpdate={vi.fn()} onRemove={onRemove} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove threshold Cap" }),
    );
    expect(onRemove).toHaveBeenCalledWith("t1");
  });
});

describe("SeriesRow", () => {
  it("names its remove button after the series", () => {
    render(
      <SeriesRow
        series={{ id: "s1", key: "vessel.altitude", label: "Altitude" }}
        numericKeys={[]}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove series Altitude" }),
    ).toBeTruthy();
  });
});
