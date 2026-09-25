import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { AttitudeIndicator } from "./AttitudeIndicator";

function texts(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map(
    (el) => el.textContent ?? "",
  );
}

describe("AttitudeIndicator", () => {
  it("rules the pitch ladder on the tens and labels every thirty degrees", () => {
    const { container } = render(
      <AttitudeIndicator heading={90} pitch={0} roll={0} size={200} />,
    );
    expect(texts(container, "svg text").sort()).toEqual(
      ["+30", "+60", "-30", "-60"].sort(),
    );
  });

  it("labels the heading tape in bearings, never past 359", () => {
    const { container } = render(
      <AttitudeIndicator heading={350} pitch={0} roll={0} size={200} />,
    );
    const labels = texts(container, "[data-heading-label]").map(Number);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((deg) => deg >= 0 && deg < 360)).toBe(true);
    expect(labels).toContain(0);
  });

  it("draws ticks on both sides of north, so a heading near 0 has no seam", () => {
    const { container } = render(
      <AttitudeIndicator heading={2} pitch={0} roll={0} size={200} />,
    );
    const lefts = Array.from(
      container.querySelectorAll("[data-heading-label]"),
    ).map((el) =>
      Number.parseFloat((el.parentElement as HTMLElement).style.left),
    );
    expect(lefts.some((left) => left < 0)).toBe(true);
  });

  it("gives two dials of the same size distinct clip ids", () => {
    const { container } = render(
      <>
        <AttitudeIndicator heading={0} pitch={0} roll={0} size={120} />
        <AttitudeIndicator heading={0} pitch={0} roll={0} size={120} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("clipPath")).map(
      (el) => el.id,
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
