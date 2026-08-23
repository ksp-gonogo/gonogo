import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import {
  SystemEntitiesLayer,
  travellingPulseWavePoints,
} from "./SystemEntitiesLayer";
import type { SystemEntitiesContext, SystemEntity } from "./systemEntities";

const CTX: SystemEntitiesContext = {
  parentName: "Kerbin",
  width: 400,
  height: 400,
  plotScale: 1e-5,
  center: { x: 0, y: 0 },
};

const POINT: SystemEntity = {
  id: "vessel-1",
  position: {
    kind: "orbit",
    parentName: "Kerbin",
    sma: 1_000_000,
    ecc: 0,
    lan: 0,
    argPe: 0,
    inclination: 0,
    trueAnomaly: 0,
  },
  shape: { kind: "point" },
  meta: { name: "Kerbal X" },
};

const RING: SystemEntity = {
  id: "ring-1",
  position: {
    kind: "orbit",
    parentName: "Kerbin",
    sma: 1_000_000,
    ecc: 0.3,
    lan: 10,
    argPe: 5,
    inclination: 0,
    trueAnomaly: 0,
  },
  shape: { kind: "orbit-path" },
};

const VESSEL_RING: SystemEntity = {
  id: "vessel-orbit:v-relay",
  vesselId: "v-relay",
  position: {
    kind: "orbit",
    parentName: "Kerbin",
    sma: 1_000_000,
    ecc: 0.3,
    lan: 10,
    argPe: 5,
    inclination: 0,
    trueAnomaly: 0,
  },
  shape: { kind: "orbit-path" },
  meta: { name: "Comsat Relay-1" },
};

const LINK: SystemEntity = {
  id: "link-1",
  position: {
    kind: "fixed",
    parentName: "Kerbin",
    xMetres: 0,
    yMetres: 0,
    zMetres: 0,
  },
  shape: {
    kind: "connection-line",
    to: {
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 200_000,
      yMetres: 0,
      zMetres: 0,
    },
  },
};

const BLOB: SystemEntity = {
  id: "cme-1",
  position: {
    kind: "fixed",
    parentName: "Kerbin",
    xMetres: 0,
    yMetres: 0,
    zMetres: 0,
  },
  shape: { kind: "blob", radiusMetres: 300_000 },
};

// bodyPx = 500_000 * CTX.plotScale (1e-5) = 5; segmentLengthPx = 100_000 *
// 1e-5 = 1 (well under bodyPx, so unclamped); exitPx = 5 + 1 = 6.
// arriveUt=100/clearUt=101 (crossingS=1) gives ratePxPerS = 1, so the wave
// departs (leadingPx=0) at UT 95 and fully clears (leadingPx=exitPx=6) at
// UT 101: a UT window chosen so every millisecond-of-nowUt below maps to a
// round leadingPx.
const TRAVELLING_PULSE: SystemEntity = {
  id: "cme-pulse-1",
  position: {
    kind: "fixed",
    parentName: "Kerbin",
    xMetres: 0,
    yMetres: 0,
    zMetres: 0,
  },
  shape: {
    kind: "travelling-pulse",
    to: {
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 500_000,
      yMetres: 0,
      zMetres: 0,
    },
    segmentLengthMetres: 100_000,
    arriveUt: 100,
    clearUt: 101,
  },
};

describe("SystemEntitiesLayer", () => {
  it("renders nothing when no entity projects onto the current frame", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[]} ctx={CTX} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws a point as a circle at its projected position", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[POINT]} ctx={CTX} />,
    );
    const circle = container.querySelector(
      '[data-entity-id="vessel-1"] circle',
    );
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute("cx")).toBe("10");
    expect(circle?.getAttribute("cy")).toBe("0");
  });

  it("draws an orbit-path as a closed polyline, with no residual rotation", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[RING]} ctx={CTX} />,
    );
    const path = container.querySelector('path[data-entity-id="ring-1"]');
    expect(path).not.toBeNull();
    const d = path?.getAttribute("d") ?? "";
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    // No `rotate()` anywhere on it. The projection has been applied to every
    // sample, so there is no residual rotation left to apply, and applying one
    // would turn an already-turned curve a second time.
    expect(path?.getAttribute("transform")).toBeNull();
    expect(path?.closest("[transform]")).toBeNull();
    expect(container.querySelector("ellipse")).toBeNull();
  });

  it("also draws a small dot at the orbit-path entity's own declared anomaly", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[RING]} ctx={CTX} />,
    );
    const dot = container.querySelector('circle[data-entity-dot-id="ring-1"]');
    expect(dot).not.toBeNull();
    // RING: sma=1e6, ecc=0.3, lan=10, argPe=5, trueAnomaly=0, plotScale=1e-5.
    expect(Number(dot?.getAttribute("cx"))).toBeCloseTo(6.7615, 3);
    expect(Number(dot?.getAttribute("cy"))).toBeCloseTo(1.8117, 3);
  });

  it("draws a connection-line between its two projected endpoints", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[LINK]} ctx={CTX} />,
    );
    const line = container.querySelector('line[data-entity-id="link-1"]');
    expect(line?.getAttribute("x1")).toBe("0");
    expect(line?.getAttribute("x2")).toBe("2");
  });

  it("draws a blob as a circle sized by radiusMetres * plotScale", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[BLOB]} ctx={CTX} />,
    );
    const circle = container.querySelector('circle[data-entity-id="cme-1"]');
    expect(Number(circle?.getAttribute("r"))).toBeCloseTo(3, 6);
  });

  it("draws a travelling-pulse as a wavy segment positioned+rotated onto its apex->tip bearing, not a static path shape", () => {
    // nowUt=96: departUt=95, ratePxPerS=1, so leadingPx=1, startPx=0.
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={96}
      />,
    );
    const group = container.querySelector('[data-entity-id="cme-pulse-1"]');
    expect(group?.tagName).toBe("g");
    // Apex (0,0) -> tip (5,0): a purely horizontal bearing, angle 0.
    expect(group?.getAttribute("transform")).toBe("translate(0 0) rotate(0)");
    // The segment is a sine-wave polyline (frazzled ejecta texture), never a
    // plain line or a static path shape.
    expect(group?.querySelector("line")).toBeNull();
    expect(
      container.querySelector('path[data-entity-id="cme-pulse-1"]'),
    ).toBeNull();
    const polyline = group?.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // startPx=0 at this nowUt: the polyline's own points ARE its current
    // world position (no wrapping transform slides them any more, see this
    // shape's `Primitive` case), so they start at the local origin here.
    expect(polyline?.getAttribute("points")).toMatch(/^0,0 /);
    // Stroked via the fade gradient, not a flat colour: see the next test.
    expect(polyline?.getAttribute("stroke")).toBe(
      "url(#system-entities-pulse-fade-cme-pulse-1)",
    );
  });

  it("clips the travelling-pulse's static exit boundary at apex->tip distance + one more segment length", () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={96}
      />,
    );
    // TRAVELLING_PULSE: bodyPx = 5 (500_000m * 1e-5), segmentLengthPx = 1
    // (100_000m * 1e-5, well under bodyPx so unclamped): exitPx = 5 + 1 = 6.
    const clipRect = container.querySelector("clipPath rect");
    expect(clipRect).not.toBeNull();
    expect(Number(clipRect?.getAttribute("width"))).toBeCloseTo(6 + 4, 6);
  });

  it("positions the travelling-pulse's leading edge from real UT against arriveUt/clearUt, not a decorative loop", () => {
    // At nowUt=arriveUt (100), the leading edge sits exactly at the tip
    // (bodyPx=5): departUt=95, ratePxPerS=1, leadingPx=1*(100-95)=5.
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={100}
      />,
    );
    const polyline = container.querySelector(
      '[data-entity-id="cme-pulse-1"] polyline',
    );
    expect(polyline).not.toBeNull();
    // startPx = leadingPx - segmentLengthPx = 5 - 1 = 4.
    expect(polyline?.getAttribute("points")).toMatch(/^4,0 /);
  });

  it("fades the travelling-pulse's fill starting exactly at the target, not before or long past it", () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={100}
      />,
    );
    const gradient = container.querySelector(
      "linearGradient#system-entities-pulse-fade-cme-pulse-1",
    );
    expect(gradient).not.toBeNull();
    // bodyPx = 5: the fade band starts exactly at the target, never before
    // it (the approaching/crossing portion stays full-strength).
    expect(Number(gradient?.getAttribute("x1"))).toBeCloseTo(5, 6);
    expect(Number(gradient?.getAttribute("x2"))).toBeGreaterThan(5);
    const stops = gradient ? Array.from(gradient.querySelectorAll("stop")) : [];
    expect(stops).toHaveLength(2);
    expect(stops[0]?.getAttribute("offset")).toBe("0");
    expect(Number(stops[0]?.getAttribute("stop-opacity"))).toBeGreaterThan(0);
    expect(stops[1]?.getAttribute("offset")).toBe("1");
    expect(Number(stops[1]?.getAttribute("stop-opacity"))).toBe(0);
  });

  it("draws nothing before the travelling-pulse has departed its apex (nowUt before departUt)", () => {
    // departUt=95: one UT before it, the wave hasn't left the star yet.
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={94}
      />,
    );
    expect(
      container.querySelector('[data-entity-id="cme-pulse-1"]'),
    ).toBeNull();
  });

  it("draws nothing once the travelling-pulse has fully cleared the target (nowUt past clearUt)", () => {
    // clearUt=101, exitPx reached exactly there: one UT later it's cleared.
    const { container } = render(
      <SystemEntitiesLayer
        entities={[TRAVELLING_PULSE]}
        ctx={CTX}
        nowUt={102}
      />,
    );
    expect(
      container.querySelector('[data-entity-id="cme-pulse-1"]'),
    ).toBeNull();
  });

  it("draws nothing when nowUt is omitted (no live UT to position the wave against)", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[TRAVELLING_PULSE]} ctx={CTX} />,
    );
    expect(
      container.querySelector('[data-entity-id="cme-pulse-1"]'),
    ).toBeNull();
  });

  it("never draws the travelling-pulse when its apex and tip coincide (zero-length bearing)", () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[
          {
            ...TRAVELLING_PULSE,
            shape: {
              kind: "travelling-pulse",
              to: TRAVELLING_PULSE.position,
              segmentLengthMetres: 100_000,
              arriveUt: 100,
              clearUt: 101,
            },
          },
        ]}
        ctx={CTX}
        nowUt={96}
      />,
    );
    expect(
      container.querySelector('[data-entity-id="cme-pulse-1"]'),
    ).toBeNull();
  });

  it("does not make a point interactive without onEntityActivate", () => {
    render(<SystemEntitiesLayer entities={[POINT]} ctx={CTX} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fires onEntityActivate on click and on Enter/Space", () => {
    const onEntityActivate = vi.fn();
    render(
      <SystemEntitiesLayer
        entities={[POINT]}
        ctx={CTX}
        onEntityActivate={onEntityActivate}
      />,
    );
    const button = screen.getByRole("button", { name: /Kerbal X/ });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(onEntityActivate).toHaveBeenCalledTimes(3);
    expect(onEntityActivate).toHaveBeenCalledWith("vessel-1");
  });

  it("reflects selectedId as aria-pressed on the matching point", () => {
    const { rerender } = render(
      <SystemEntitiesLayer
        entities={[POINT]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId={null}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(
      <SystemEntitiesLayer
        entities={[POINT]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-1"
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("gives the interactive point marker a visible :focus-visible ring", () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[POINT]}
        ctx={CTX}
        onEntityActivate={() => {}}
      />,
    );
    const marker = container.querySelector('[data-entity-id="vessel-1"]');
    expect(marker).not.toBeNull();

    // The ring itself: hidden by default, only shown by the CSS below.
    const focusRing = marker?.querySelector("circle.focus-ring");
    expect(focusRing).not.toBeNull();

    // styled-components injects the actual rules into <style> tags in
    // jsdom; confirm the marker's own generated class carries a
    // `:focus-visible` rule that reveals `.focus-ring`, and that the base
    // rule doesn't just strip the outline without this replacement (the
    // bug this test guards against).
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const markerClass = Array.from(marker?.classList ?? []).find((cls) =>
      css.includes(`.${cls}`),
    );
    expect(markerClass).toBeDefined();
    expect(css).toContain(`.${markerClass}:focus-visible .focus-ring`);
    expect(css).toMatch(/outline:\s*none/);
  });

  it("does not add a focus ring or make a non-interactive point focusable", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[POINT]} ctx={CTX} />,
    );
    const marker = container.querySelector('[data-entity-id="vessel-1"]');
    expect(marker?.querySelector("circle.focus-ring")).toBeNull();
    expect(marker).not.toHaveAttribute("tabIndex");
  });

  it("has no axe violations with an interactive point marker rendered", async () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[POINT, RING, LINK, BLOB, TRAVELLING_PULSE]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-1"
        nowUt={96}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("does not make an orbit-path with no vesselId interactive, even with onEntityActivate", () => {
    render(
      <SystemEntitiesLayer
        entities={[RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("makes a vessel's orbit-path ring (vesselId set) interactive: fires onEntityActivate on click and Enter/Space", () => {
    const onEntityActivate = vi.fn();
    render(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={onEntityActivate}
      />,
    );
    const button = screen.getByRole("button", { name: /Comsat Relay-1/ });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    expect(onEntityActivate).toHaveBeenCalledTimes(3);
    expect(onEntityActivate).toHaveBeenCalledWith("vessel-orbit:v-relay");
  });

  it("draws the interactive vessel ring's dot as a non-interactive sibling, outside the clickable marker", () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
      />,
    );
    const dot = container.querySelector(
      'circle[data-entity-dot-id="vessel-orbit:v-relay"]',
    );
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("pointer-events", "none");
    // Not nested inside the button-role marker: a decoration, not a second
    // hit target riding the same rotated frame as the ring's own geometry.
    const button = screen.getByRole("button", { name: /Comsat Relay-1/ });
    expect(button.contains(dot)).toBe(false);
  });

  it("reflects selectedId as aria-pressed on the matching vessel orbit-path ring", () => {
    const { rerender } = render(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId={null}
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-orbit:v-relay"
      />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("thickens (as well as brightening) a vessel orbit-path ring's own visible stroke when selected", () => {
    const { container, rerender } = render(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId={null}
      />,
    );
    const ringBefore = container.querySelector(
      '[data-entity-id="vessel-orbit:v-relay"] [data-ring="true"]',
    );
    const widthBefore = Number(ringBefore?.getAttribute("stroke-width"));
    rerender(
      <SystemEntitiesLayer
        entities={[VESSEL_RING]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-orbit:v-relay"
      />,
    );
    const ringAfter = container.querySelector(
      '[data-entity-id="vessel-orbit:v-relay"] [data-ring="true"]',
    );
    const widthAfter = Number(ringAfter?.getAttribute("stroke-width"));
    expect(widthAfter).toBeGreaterThan(widthBefore);
  });

  it("has no axe violations with an interactive vessel orbit-path ring rendered", async () => {
    const { container } = render(
      <SystemEntitiesLayer
        entities={[VESSEL_RING, LINK, BLOB]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-orbit:v-relay"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  describe("pulses", () => {
    it("renders nothing extra with no pending traffic (omitted or empty)", () => {
      const { container: withoutProp } = render(
        <SystemEntitiesLayer entities={[LINK]} ctx={CTX} />,
      );
      expect(withoutProp.querySelectorAll("[data-pulse-edge-id]")).toHaveLength(
        0,
      );

      const { container: withEmpty } = render(
        <SystemEntitiesLayer entities={[LINK]} ctx={CTX} pulses={[]} />,
      );
      expect(withEmpty.querySelectorAll("[data-pulse-edge-id]")).toHaveLength(
        0,
      );
    });

    it("draws a pulse as a line along its edge's already-projected endpoints, not a marker at a single point", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[{ id: "cmd-1", edgeId: "link-1", t: 0.5, opacity: 0.75 }]}
        />,
      );
      // LINK projects to x1=0, x2=2 (see the "connection-line" test above):
      // the pulse rides the SAME endpoints, it never re-derives a position.
      const pulse = container.querySelector('[data-pulse-edge-id="link-1"]');
      expect(pulse?.tagName).toBe("line");
      expect(pulse?.getAttribute("x1")).toBe("0");
      expect(pulse?.getAttribute("x2")).toBe("2");
      expect(pulse?.getAttribute("y1")).toBe("0");
      expect(pulse?.getAttribute("y2")).toBe("0");
    });

    it("gives the pulse a gradient stroke whose bright stop sits at t and carries the pulse's own opacity", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[{ id: "cmd-1", edgeId: "link-1", t: 0.5, opacity: 0.75 }]}
        />,
      );
      const pulse = container.querySelector('[data-pulse-edge-id="link-1"]');
      const stroke = pulse?.getAttribute("stroke") ?? "";
      const gradientId = stroke.match(/url\(#([^)]+)\)/)?.[1];
      expect(gradientId).toBeDefined();
      const gradient = container.querySelector(`#${gradientId}`);
      expect(gradient?.tagName).toBe("linearGradient");
      // Gradient coordinate space matches the edge's own endpoints, so the
      // bright band travels ALONG the line rather than across it.
      expect(gradient?.getAttribute("x1")).toBe("0");
      expect(gradient?.getAttribute("x2")).toBe("2");
      const stops = gradient?.querySelectorAll("stop") ?? [];
      expect(stops).toHaveLength(3);
      const peak = stops[1];
      expect(peak.getAttribute("offset")).toBe("0.5");
      expect(peak.getAttribute("stop-opacity")).toBe("0.75");
      // The band's two ends fade to transparent: a travelling glow, not a
      // solid bright line end to end.
      expect(stops[0].getAttribute("stop-opacity")).toBe("0");
      expect(stops[2].getAttribute("stop-opacity")).toBe("0");
    });

    it("never draws a circle marker for a pulse (the old vessel-like language)", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[{ id: "cmd-1", edgeId: "link-1", t: 0.5, opacity: 1 }]}
        />,
      );
      expect(
        container.querySelector('circle[data-pulse-edge-id="link-1"]'),
      ).toBeNull();
    });

    it("silently skips a pulse whose edgeId matches no resolved connection-line", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[{ id: "cmd-1", edgeId: "no-such-edge", t: 0.5, opacity: 1 }]}
        />,
      );
      expect(container.querySelectorAll("[data-pulse-edge-id]")).toHaveLength(
        0,
      );
    });

    it("renders one marker per pulse when several share the same edge", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[
            { id: "cmd-1", edgeId: "link-1", t: 0.2, opacity: 1 },
            { id: "cmd-2", edgeId: "link-1", t: 0.8, opacity: 0.5 },
          ]}
        />,
      );
      expect(
        container.querySelectorAll('[data-pulse-edge-id="link-1"]'),
      ).toHaveLength(2);
    });

    it("pulse markers are never interactive (pointer-events: none, no role)", () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[LINK]}
          ctx={CTX}
          pulses={[{ id: "cmd-1", edgeId: "link-1", t: 0.5, opacity: 1 }]}
        />,
      );
      const pulse = container.querySelector('[data-pulse-edge-id="link-1"]');
      expect(pulse).toHaveAttribute("pointer-events", "none");
      expect(pulse).not.toHaveAttribute("role");
    });

    it("has no axe violations with pulses rendered alongside an interactive marker", async () => {
      const { container } = render(
        <SystemEntitiesLayer
          entities={[VESSEL_RING, LINK]}
          ctx={CTX}
          onEntityActivate={() => {}}
          pulses={[{ id: "cmd-1", edgeId: "link-1", t: 0.5, opacity: 1 }]}
        />,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});

describe("travellingPulseWavePoints", () => {
  it("starts every wave at the local origin, y=0", () => {
    expect(travellingPulseWavePoints(50)).toMatch(/^0,0 /);
  });

  it("ends exactly at the requested length", () => {
    const points = travellingPulseWavePoints(50).split(" ");
    const [lastX] = points[points.length - 1].split(",").map(Number);
    expect(lastX).toBeCloseTo(50, 6);
  });

  it("oscillates rather than staying flat: some sampled y is non-zero", () => {
    const points = travellingPulseWavePoints(50)
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(points.some((y) => Math.abs(y) > 0.5)).toBe(true);
  });

  it("degrades to a short two-point segment for a length under one sample step", () => {
    // Never zero points even for a near-zero length: a degenerate polyline
    // (a single coordinate pair) is still a valid, harmless <polyline>.
    expect(travellingPulseWavePoints(0.5).split(" ")).toHaveLength(2);
  });

  it("shifts every point's x by offsetPx while keeping the ripple phase anchored to LOCAL x", () => {
    // The ripple TEXTURE is unchanged (same y at the same local position),
    // only where that textured segment sits moves: this is what lets a
    // caller position the CURRENT wave without regenerating its shape.
    const base = travellingPulseWavePoints(50)
      .split(" ")
      .map((p) => p.split(",").map(Number));
    const shifted = travellingPulseWavePoints(50, 10)
      .split(" ")
      .map((p) => p.split(",").map(Number));
    expect(shifted).toHaveLength(base.length);
    for (const [i, [x, y]] of shifted.entries()) {
      expect(x).toBeCloseTo(base[i][0] + 10, 6);
      expect(y).toBeCloseTo(base[i][1], 6);
    }
  });
});
