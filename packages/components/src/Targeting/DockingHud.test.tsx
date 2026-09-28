import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { DockingHud } from "./DockingHud";

function reticle(ax: number, ay: number): HTMLElement {
  const { container } = render(
    <DockingHud
      name="Docking Port Mk2"
      distance={62}
      relVel={-0.4}
      ax={ax}
      ay={ay}
      az={0}
      x={0}
      y={0}
      forwardDot={0.99}
      modelled={undefined}
      showCamera={false}
      cameraFlightId={undefined}
      cols={6}
      rows={9}
    />,
  );
  const ring = [...container.querySelectorAll<HTMLElement>("div")].find(
    (el) => el.style.borderRadius === "var(--radius-circle)",
  );
  if (!ring) throw new Error("no reticle ring rendered");
  return ring;
}

/** The pixel offset from centre in a `calc(50% + Npx)` position. */
function offsetPx(position: string): number {
  const match = /^calc\(50% \+ (-?[\d.]+)px\)$/.exec(position);
  if (!match) throw new Error(`not a centre-relative position: ${position}`);
  return Number(match[1]);
}

describe("DockingHud reticle", () => {
  it("moves as far across for a degree of yaw as down for a degree of pitch", () => {
    const ring = reticle(4, -4);
    expect(offsetPx(ring.style.left)).toBeGreaterThan(0);
    expect(offsetPx(ring.style.left)).toBe(offsetPx(ring.style.top));
  });

  it("sits dead centre when aligned", () => {
    const ring = reticle(0, 0);
    expect(offsetPx(ring.style.left)).toBe(0);
    expect(offsetPx(ring.style.top)).toBe(0);
  });
});
