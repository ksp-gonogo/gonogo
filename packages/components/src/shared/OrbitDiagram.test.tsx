import { render } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OrbitDiagram } from "./OrbitDiagram";

const BASE = {
  sma: 700_000,
  ecc: 0.1,
  apoapsis: 770_000,
  periapsis: 630_000,
  trueAnomaly: 0,
  argPe: 0,
};

describe("OrbitDiagram projected overlay", () => {
  it("renders only the current orbit when no projected prop is supplied", () => {
    const { container } = render(<OrbitDiagram {...BASE} />);
    expect(container.querySelectorAll("ellipse")).toHaveLength(1);
  });

  it("renders two ellipses when a projected orbit is supplied", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        projected={{
          sma: 770_000,
          ecc: 0,
          apoapsis: 770_000,
          periapsis: 770_000,
        }}
      />,
    );
    const ellipses = container.querySelectorAll("ellipse");
    expect(ellipses).toHaveLength(2);
    // Projected ellipse is drawn first (underneath) and is the dashed one.
    expect(ellipses[0].getAttribute("stroke-dasharray")).not.toBeNull();
    expect(ellipses[1].getAttribute("stroke-dasharray")).toBeNull();
  });

  // A single closed path would be a blob covering the gap the corridor exists to show.
  it("fills the region between the two conics as a two-subpath even-odd ring", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        projected={{
          sma: 800_000,
          ecc: 0.12,
          apoapsis: 896_000,
          periapsis: 704_000,
        }}
        corridor
      />,
    );

    const ring = container.querySelector('path[fill-rule="evenodd"]');
    expect(ring).not.toBeNull();
    const d = ring?.getAttribute("d") ?? "";
    expect(d.match(/M/g) ?? []).toHaveLength(2);
    expect(d.match(/Z/g) ?? []).toHaveLength(2);
  });

  it("draws no corridor without the prop, so every other caller is untouched", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        projected={{
          sma: 800_000,
          ecc: 0.12,
          apoapsis: 896_000,
          periapsis: 704_000,
        }}
      />,
    );

    expect(container.querySelector('path[fill-rule="evenodd"]')).toBeNull();
  });

  it("withholds the corridor when either conic is unbounded", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        projected={{ sma: -900_000, ecc: 1.4, apoapsis: 0, periapsis: 650_000 }}
        corridor
      />,
    );

    expect(container.querySelector('path[fill-rule="evenodd"]')).toBeNull();
  });

  it("bakes each conic's own argPe into the ring rather than a shared transform", () => {
    const projected = {
      sma: 800_000,
      ecc: 0.12,
      apoapsis: 896_000,
      periapsis: 704_000,
      argPe: 90,
    };
    const aligned = render(
      <OrbitDiagram
        {...BASE}
        projected={{ ...projected, argPe: 0 }}
        corridor
      />,
    );
    const rotated = render(
      <OrbitDiagram {...BASE} projected={projected} corridor />,
    );

    const of = (r: { container: Element }) =>
      r.container.querySelector('path[fill-rule="evenodd"]')?.getAttribute("d");

    expect(of(aligned)).not.toBeUndefined();
    expect(of(rotated)).not.toEqual(of(aligned));
  });

  it("expands the mini viewBox to contain an argPe-rotated orbit", () => {
    const { container } = render(
      <OrbitDiagram {...BASE} variant="mini" argPe={90} />,
    );
    const vb = container.querySelector("svg")?.getAttribute("viewBox") ?? "";
    const [, , wStr, hStr] = vb.split(" ");
    const w = Number.parseFloat(wStr ?? "0");
    const h = Number.parseFloat(hStr ?? "0");
    // At argPe 90 the long axis is vertical.
    expect(h).toBeGreaterThan(w);
  });

  it("swaps the apoapsis label for its altitude on hover", async () => {
    const user = userEvent.setup();
    // Apoapsis 770 km on a 600 km body is 170 km up.
    const { container } = render(
      <OrbitDiagram {...BASE} bodyRadius={600_000} />,
    );
    const findApText = () =>
      Array.from(container.querySelectorAll("text")).find(
        (t) => t.textContent === "Ap",
      );
    expect(findApText()).toBeTruthy();
    const apMarker = container.querySelector(
      'circle[fill="var(--color-warn-mark)"]',
    );
    expect(apMarker).toBeTruthy();
    if (!apMarker) return;
    await user.hover(apMarker);
    expect(findApText()).toBeUndefined();
    expect(
      Array.from(container.querySelectorAll("text")).some((t) =>
        (t.textContent ?? "").includes("170.0 km"),
      ),
    ).toBe(true);
    await user.unhover(apMarker);
    expect(findApText()).toBeTruthy();
  });

  it("omits the rotation marker when rotationAngleDeg is not supplied", () => {
    const { container } = render(
      <OrbitDiagram {...BASE} bodyRadius={600_000} />,
    );
    // The rotation marker is the only translucent white line.
    const lines = Array.from(container.querySelectorAll("line"));
    const rotationLine = lines.find((l) =>
      (l.getAttribute("stroke") ?? "").includes("255, 255, 255"),
    );
    expect(rotationLine).toBeUndefined();
  });

  it("renders the rotation marker when rotationAngleDeg is supplied", () => {
    const { container } = render(
      <OrbitDiagram {...BASE} bodyRadius={600_000} rotationAngleDeg={45} />,
    );
    const lines = Array.from(container.querySelectorAll("line"));
    const rotationLine = lines.find((l) =>
      (l.getAttribute("stroke") ?? "").includes("255, 255, 255"),
    );
    expect(rotationLine).toBeTruthy();
  });

  it("draws the atmosphere band only when atmosphereDepthM is supplied", () => {
    const without = render(<OrbitDiagram {...BASE} bodyRadius={600_000} />);
    const withBand = render(
      <OrbitDiagram {...BASE} bodyRadius={600_000} atmosphereDepthM={70_000} />,
    );
    const isAtmoCircle = (el: Element) =>
      (el.getAttribute("fill") ?? "").startsWith("rgba(220, 140, 60");
    expect(
      Array.from(without.container.querySelectorAll("circle")).some(
        isAtmoCircle,
      ),
    ).toBe(false);
    expect(
      Array.from(withBand.container.querySelectorAll("circle")).some(
        isAtmoCircle,
      ),
    ).toBe(true);
  });

  it("expands the viewBox to contain a larger projected apoapsis", () => {
    const { container: plain } = render(<OrbitDiagram {...BASE} />);
    const { container: withProj } = render(
      <OrbitDiagram
        {...BASE}
        projected={{
          sma: 2_000_000,
          ecc: 0.5,
          apoapsis: 3_000_000,
          periapsis: 1_000_000,
        }}
      />,
    );
    const plainVb = plain.querySelector("svg")?.getAttribute("viewBox") ?? "";
    const withVb = withProj.querySelector("svg")?.getAttribute("viewBox") ?? "";
    const plainW = Number.parseFloat(plainVb.split(" ")[2] ?? "0");
    const withW = Number.parseFloat(withVb.split(" ")[2] ?? "0");
    expect(withW).toBeGreaterThan(plainW);
  });
});

/** A short supplied arc heading straight along +x, so its stop mark is vertical. */
const SUPPLIED = [
  { x: 600_000, y: 0 },
  { x: 650_000, y: 0 },
  { x: 700_000, y: 0 },
];

describe("OrbitDiagram horizon mark", () => {
  it("marks a path that stopped after one revolution", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={SUPPLIED}
        trajectoryFarEnd="revolution"
      />,
    );
    const mark = container.querySelector("[data-trajectory-mark]");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("data-trajectory-mark")).toBe("revolution");
  });

  it("does NOT mark a path that merely reached its horizon", () => {
    // Every integrated path is bounded, so a horizon mark would sit on nearly every arc.
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={SUPPLIED}
        trajectoryFarEnd="horizon"
      />,
    );

    expect(container.querySelector("[data-trajectory-mark]")).toBeNull();
  });

  it("draws it as a bar across the curve, not as a fade", () => {
    // Geometry, not existence: a zero-length mark or one along the heading would pass an existence check.
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={SUPPLIED}
        trajectoryFarEnd="revolution"
      />,
    );
    const mark = container.querySelector("line[data-trajectory-mark]");
    expect(mark).not.toBeNull();
    const x1 = Number.parseFloat(mark?.getAttribute("x1") ?? "0");
    const x2 = Number.parseFloat(mark?.getAttribute("x2") ?? "0");
    const y1 = Number.parseFloat(mark?.getAttribute("y1") ?? "0");
    const y2 = Number.parseFloat(mark?.getAttribute("y2") ?? "0");
    expect(x1).toBeCloseTo(x2, 6);
    expect(Math.abs(y2 - y1)).toBeGreaterThan(0);
    expect(x1).toBeCloseTo(700_000, 6);
    const path = container.querySelector('path[data-trajectory="supplied"]');
    expect(path?.getAttribute("stroke")).not.toMatch(/url\(#/);
    expect(path?.getAttribute("opacity")).toBeNull();
  });

  it("says a revolution is a drawing convention, not a horizon", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={SUPPLIED}
        trajectoryFarEnd="revolution"
      />,
    );
    const mark = container.querySelector("[data-trajectory-mark]");
    expect(mark?.getAttribute("data-trajectory-mark")).toBe("revolution");
    expect(mark?.textContent).toContain("One revolution drawn");
  });

  it("draws no mark where there is no supplied path to end", () => {
    const { container } = render(<OrbitDiagram {...BASE} />);
    expect(container.querySelector("[data-trajectory-mark]")).toBeNull();
  });

  it("draws no mark from a single point, which has no heading", () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={[{ x: 700_000, y: 0 }]}
        trajectoryFarEnd="horizon"
      />,
    );
    expect(container.querySelector("[data-trajectory-mark]")).toBeNull();
  });

  it("has no accessibility violations with the mark drawn", async () => {
    const { container } = render(
      <OrbitDiagram
        {...BASE}
        trajectoryPath={SUPPLIED}
        trajectoryFarEnd="horizon"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
