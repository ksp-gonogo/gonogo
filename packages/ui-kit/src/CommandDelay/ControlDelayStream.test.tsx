import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  ControlDelayStream,
  type ControlStreamDatum,
} from "./ControlDelayStream";

function stream(over: Partial<ControlStreamDatum> = {}): ControlStreamDatum {
  return {
    id: "vessel.control.throttle",
    label: "Throttle",
    oneWaySeconds: 1.6,
    inTransit: [
      { age: 0, value: 0.5 },
      { age: 2.4, value: 0.6 },
      { age: 4.8, value: 0.6 },
    ],
    echo: [{ age: 3.2, value: 0.6 }],
    current: 0.5,
    ...over,
  };
}

describe("ControlDelayStream", () => {
  it("renders nothing when the one-way delay is near zero", () => {
    const { container } = render(
      <ControlDelayStream streams={[stream({ oneWaySeconds: 0.01 })]} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing with no streams", () => {
    const { container } = render(<ControlDelayStream streams={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws the two zone dividers and a commanded path per stream", () => {
    const { container, getByRole } = render(
      <ControlDelayStream
        streams={[
          stream(),
          stream({ id: "vessel.control.pitch", label: "Pitch" }),
        ]}
        ariaLabel="Navball controls in flight"
      />,
    );
    expect(getByRole("img")).toHaveAttribute(
      "aria-label",
      "Navball controls in flight",
    );
    expect(container.querySelectorAll("[data-divider]")).toHaveLength(2);
    expect(container.querySelectorAll('[data-role="commanded"]')).toHaveLength(
      2,
    );
  });

  it("draws the deviation branch when the echo diverges from the commanded path", () => {
    const diverged = stream({
      echo: [{ age: 3.2, value: 0.95 }],
    });
    const { container } = render(<ControlDelayStream streams={[diverged]} />);
    expect(
      container.querySelector('[data-role="deviation-actual"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-role="deviation-expected"]'),
    ).not.toBeNull();
  });

  it("colours only the echo path from the first diverging sample onward, not the whole path", () => {
    // Three confirmed samples: the first matches the commanded value (no
    // deviation), the second and third diverge past the epsilon. The actual-
    // orange treatment must stem FROM the divergence point (the second
    // sample), not repaint the whole echo path orange.
    const partiallyDiverged = stream({
      inTransit: [
        { age: 0, value: 0.6 },
        { age: 4.8, value: 0.6 },
      ],
      echo: [
        { age: 3.2, value: 0.6 }, // matches: still "confirmed", not deviating
        { age: 4.0, value: 0.95 }, // diverges here
        { age: 4.8, value: 0.95 }, // stays diverged
      ],
    });
    const { container } = render(
      <ControlDelayStream streams={[partiallyDiverged]} />,
    );
    const confirmed = container.querySelector('[data-role="echo"]');
    const deviation = container.querySelector('[data-role="deviation-actual"]');
    const expected = container.querySelector(
      '[data-role="deviation-expected"]',
    );
    expect(confirmed).not.toBeNull();
    expect(deviation).not.toBeNull();
    expect(expected).not.toBeNull();

    // The pre-divergence segment covers exactly the first two samples (the
    // matching one plus the shared vertex where it diverges): one "M" + one
    // "L" = 2 draw commands. It must NOT extend into the diverged region.
    const confirmedCommands = confirmed?.getAttribute("d")?.match(/[ML]/g);
    expect(confirmedCommands).toHaveLength(2);

    // The deviation segment starts AT that same shared vertex and covers the
    // remaining two samples: it must NOT reach back before the divergence.
    const deviationCommands = deviation?.getAttribute("d")?.match(/[ML]/g);
    expect(deviationCommands).toHaveLength(2);

    // Deviation-actual gets the reserved warning treatment; the pre-
    // divergence "echo" segment does not.
    expect(deviation).toHaveAttribute("data-deviation", "true");
    expect(confirmed).not.toHaveAttribute("data-deviation");
    expect(deviation).toHaveAttribute(
      "stroke",
      "var(--color-status-warning-bg)",
    );
    expect(confirmed).not.toHaveAttribute(
      "stroke",
      "var(--color-status-warning-bg)",
    );
  });

  it("gives every instance its own gradient id, never colliding across mounted widgets", () => {
    // Two independently-mounted streams (the same shape two Navball
    // instances, or a Navball plus a second control widget, would produce):
    // a hardcoded `cds-ramp-${index}` id collides across them, and one
    // instance's <linearGradient> silently wins for both `url(#...)`
    // references.
    const { container: a } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    const { container: b } = render(
      <ControlDelayStream streams={[stream()]} />,
    );
    const idsA = Array.from(a.querySelectorAll("linearGradient")).map((el) =>
      el.getAttribute("id"),
    );
    const idsB = Array.from(b.querySelectorAll("linearGradient")).map((el) =>
      el.getAttribute("id"),
    );
    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);
    expect(idsA[0]).toBeTruthy();
    expect(idsA[0]).not.toBe(idsB[0]);
  });

  it("draws a confidence-ramp gradient from muted (left) to clear (right)", () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    const gradient = container.querySelector("linearGradient");
    expect(gradient).not.toBeNull();

    const stops = Array.from(gradient?.querySelectorAll("stop") ?? []);
    expect(stops.length).toBeGreaterThanOrEqual(2);

    const offsets = stops.map((s) => Number(s.getAttribute("offset")));
    const opacities = stops.map((s) => Number(s.getAttribute("stop-opacity")));

    // Muted left, clear right: both offset and opacity strictly ascend.
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]).toBeGreaterThan(opacities[i - 1]);
    }

    // The commanded path actually rides this gradient, not a flat colour.
    const commanded = container.querySelector('[data-role="commanded"]');
    expect(commanded).toHaveAttribute(
      "stroke",
      `url(#${gradient?.getAttribute("id")})`,
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(<ControlDelayStream streams={[stream()]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
