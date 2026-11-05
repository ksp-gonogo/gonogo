import { render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installRendezvousBox } from "../test/rendezvousBox";
import { flushResizeObservers } from "../test/widgetDomSnapshot";
import { DockingCircle } from "./DockingCircle";

let restore = () => {};
beforeEach(() => {
  restore = installRendezvousBox({ w: 200, h: 200 });
});
afterEach(() => restore());

async function drawn(angles: {
  ax?: number;
  ay?: number;
  forwardDot?: number;
  docked?: boolean;
}) {
  const view = render(
    <DockingCircle
      distance={62}
      figuresReading={undefined}
      ax={angles.ax}
      ay={angles.ay}
      forwardDot={angles.forwardDot ?? 0.99}
      docked={angles.docked ?? false}
      targetPort={undefined}
      showCamera={false}
      cameraFlightId={undefined}
      picture={null}
      onPicture={() => {}}
    />,
  );
  // The measured size lands in a state update after the first paint.
  await flushResizeObservers();
  return view;
}

async function reticle(
  angles: Parameters<typeof drawn>[0],
): Promise<HTMLElement> {
  const { container } = await drawn(angles);
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

describe("DockingCircle reticle", () => {
  it("moves as far across for a degree of yaw as down for a degree of pitch", async () => {
    const ring = await reticle({ ax: 4, ay: -4 });
    expect(offsetPx(ring.style.left)).toBeGreaterThan(0);
    expect(offsetPx(ring.style.left)).toBe(offsetPx(ring.style.top));
  });

  it("draws no ring once the port is past the rim, leaving the border cue to say so", async () => {
    const { container } = await drawn({ ax: 40, ay: -40 });
    const ring = [...container.querySelectorAll<HTMLElement>("div")].find(
      (el) => el.style.borderRadius === "var(--radius-circle)",
    );
    expect(ring).toBeUndefined();
  });

  it("keeps the ring inside the rim while the port is still inside the field", async () => {
    const ring = await reticle({ ax: 7.9, ay: 0 });
    // The circle is 200 px; the rim less the reticle's own radius is 88.
    expect(offsetPx(ring.style.left)).toBeCloseTo(88, 0);
  });

  it("sits dead centre when aligned", async () => {
    const ring = await reticle({ ax: 0, ay: 0 });
    expect(offsetPx(ring.style.left)).toBe(0);
    expect(offsetPx(ring.style.top)).toBe(0);
  });
});

describe("DockingCircle aligned tint", () => {
  const tinted = async (forwardDot: number) =>
    (await reticle({ forwardDot })).style.border.includes("accent-fg");

  it("is aligned for ports facing head-on, whose forward vectors are opposed", async () => {
    expect(await tinted(-1)).toBe(true);
    expect(await tinted(1)).toBe(false);
  });
});

describe("DockingCircle triangles", () => {
  const marks = (container: HTMLElement) => [
    ...container.querySelectorAll<SVGPathElement>("[data-dock-marks] path"),
  ];

  it("draws four round the port while it is inside the circle, amber off the line", async () => {
    const { container } = await drawn({ ax: 3, ay: 3 });
    const paths = marks(container);
    expect(paths.map((p) => p.dataset.mark)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    expect(paths[0].style.stroke).toBe("var(--color-warn-mark)");
  });

  it("goes green on each axis within a degree of the line", async () => {
    const { container } = await drawn({ ax: 0.5, ay: 3 });
    const byMark = Object.fromEntries(
      marks(container).map((p) => [p.dataset.mark, p.style.stroke]),
    );
    expect(byMark.left).toBe("var(--color-accent-fg)");
    expect(byMark.top).toBe("var(--color-warn-mark)");
  });

  it("leaves them out once the port is past the rim", async () => {
    const { container } = await drawn({ ax: 30, ay: 0 });
    expect(marks(container)).toHaveLength(0);
  });

  it("is all green, centred, with no reticle once docked", async () => {
    const { container } = await drawn({ ax: 5, ay: 5, docked: true });
    const paths = marks(container);
    expect(paths).toHaveLength(4);
    for (const p of paths) {
      expect(p.style.stroke).toBe("var(--color-accent-fg)");
      expect(p.style.fill).toBe("var(--color-accent-fg)");
    }
    const ring = [...container.querySelectorAll<HTMLElement>("div")].find(
      (el) => el.style.borderRadius === "var(--radius-circle)",
    );
    expect(ring).toBeUndefined();
  });
});
