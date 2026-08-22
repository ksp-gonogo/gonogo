import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { SystemEntitiesLayer } from "./SystemEntitiesLayer";
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
    trueAnomaly: 0,
  },
  shape: { kind: "orbit-path" },
  meta: { name: "Comsat Relay-1" },
};

const LINK: SystemEntity = {
  id: "link-1",
  position: { kind: "fixed", parentName: "Kerbin", xMetres: 0, yMetres: 0 },
  shape: {
    kind: "connection-line",
    to: { kind: "fixed", parentName: "Kerbin", xMetres: 200_000, yMetres: 0 },
  },
};

const BLOB: SystemEntity = {
  id: "cme-1",
  position: { kind: "fixed", parentName: "Kerbin", xMetres: 0, yMetres: 0 },
  shape: { kind: "blob", radiusMetres: 300_000 },
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

  it("draws an orbit-path as a rotated ellipse", () => {
    const { container } = render(
      <SystemEntitiesLayer entities={[RING]} ctx={CTX} />,
    );
    const g = container.querySelector('g[data-entity-id="ring-1"]');
    expect(g?.getAttribute("transform")).toBe("rotate(15)");
    expect(g?.querySelector("ellipse")).not.toBeNull();
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
        entities={[POINT, RING, LINK, BLOB]}
        ctx={CTX}
        onEntityActivate={() => {}}
        selectedId="vessel-1"
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
});
