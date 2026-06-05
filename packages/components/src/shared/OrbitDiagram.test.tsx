import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
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
  afterEach(() => {
    cleanup();
  });

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

  it("expands the mini viewBox to contain an argPe-rotated orbit", () => {
    // At argPe=0 the orbit's wide axis is x; at argPe=90° it's y. The mini
    // viewBox used to assume argPe=0 and would clip rotated orbits — we
    // now compute the rotated bbox so the orbit stays inside the frame.
    const { container } = render(
      <OrbitDiagram {...BASE} variant="mini" argPe={90} />,
    );
    const vb = container.querySelector("svg")?.getAttribute("viewBox") ?? "";
    const [, , wStr, hStr] = vb.split(" ");
    const w = Number.parseFloat(wStr ?? "0");
    const h = Number.parseFloat(hStr ?? "0");
    // After rotation the long axis (apoapsis + periapsis) is vertical;
    // the bbox should be taller than wide.
    expect(h).toBeGreaterThan(w);
  });

  it("swaps the apoapsis label for its altitude on hover", async () => {
    const user = userEvent.setup();
    // bodyRadius=600_000, apoapsis=770_000 → altitude = 170 km
    const { container } = render(
      <OrbitDiagram {...BASE} bodyRadius={600_000} />,
    );
    // Find the Ap text label (outside the rotation group).
    const findApText = () =>
      Array.from(container.querySelectorAll("text")).find(
        (t) => t.textContent === "Ap",
      );
    expect(findApText()).toBeTruthy();
    // The marker hit-target is the styled <circle> with cursor:help.
    const apMarker = container.querySelector(
      'circle[fill="var(--color-status-warning-bg)"]',
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
    // Rotation marker is identifiable by the body-fill cross-line — a thin
    // white-translucent line inside the body disc. No matching stroke on
    // the default render.
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
    // Atmosphere disc is a <circle> with the oxygen / non-oxygen rgba fill.
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
