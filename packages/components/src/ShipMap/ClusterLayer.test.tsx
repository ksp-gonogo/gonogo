import type { VesselTopology } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import lfv2WaveProbe from "./__fixtures__/lfv2-wave-probe-14parts.json";
import { ShipDiagram } from "./ShipDiagram";
import { buildShipMapPart } from "./shipTopology";
import { pickView } from "./shipView";

/** A captured topology fixture; its free-text note is declared because an undeclared key fails the cast. */
interface Fixture {
  "v.topology": VesselTopology;
  _comment?: string;
}

function partsOf(fixture: Fixture) {
  const topo = fixture["v.topology"];
  const view = pickView(topo.parts);
  return topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, view));
}

describe("the expand icon on a dense cluster", () => {
  it("appears beside the probe's ring of nine, closed", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", {
      name: "Expand the 9 parts clustered here",
    });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-role="cluster-box"]')).toBeNull();
  });

  it("is absent on a craft with no cluster", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(fuellinePostStage2 as Fixture)}
        width={600}
        height={700}
      />,
    );
    expect(container.querySelector('[data-role="cluster-expand"]')).toBeNull();
  });

  it("pins a popover with each part when pressed", () => {
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    const box = document.body.querySelector('[data-role="cluster-box"]');
    expect(box).not.toBeNull();
    expect(
      document.body.querySelectorAll('[data-role="cluster-member"]'),
    ).toHaveLength(9);
    expect(
      screen
        .getByRole("button", { name: /Close the 9 parts/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("draws the popover outside the diagram's own tree, so the widget cannot clip it", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    expect(container.querySelector('[data-role="cluster-box"]')).toBeNull();
    expect(
      document.body.querySelector('[data-role="cluster-box"]'),
    ).not.toBeNull();
  });

  it("shows the popover while the pointer is on the icon and drops it after the pointer leaves", async () => {
    const user = userEvent.setup();
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    await user.hover(icon);
    expect(
      document.body.querySelector('[data-role="cluster-box"]'),
    ).not.toBeNull();
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    await user.unhover(icon);
    await waitFor(() =>
      expect(
        document.body.querySelector('[data-role="cluster-box"]'),
      ).toBeNull(),
    );
  });

  it("shows the popover on keyboard focus like hover", () => {
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    act(() => icon.focus());
    expect(
      document.body.querySelector('[data-role="cluster-box"]'),
    ).not.toBeNull();
  });

  it("pins from the keyboard and closes on Escape with focus back on the icon", () => {
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    fireEvent.keyDown(icon, { key: "Enter" });
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.querySelector('[data-role="cluster-box"]')).toBeNull();
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement?.getAttribute("data-role")).toBe(
      "cluster-expand",
    );
  });

  it("closes a pinned popover on a press outside it, and keeps it for a press on the icon or inside the box", () => {
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    fireEvent.click(icon);
    const box = () => document.body.querySelector('[data-role="cluster-box"]');
    fireEvent.pointerDown(box() as Element);
    expect(box()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(box()).toBeNull();
  });

  it("stops Escape before an enclosing handler sees it", () => {
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it("lets Escape reach an enclosing handler while the popover shows on hover only", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    await user.hover(
      screen.getByRole("button", { name: /Expand the 9 parts/ }),
    );
    expect(
      document.body.querySelector('[data-role="cluster-box"]'),
    ).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(outer).toHaveBeenCalled();
  });

  it("does not toggle a second time when the click after a touch tap arrives late", () => {
    vi.useFakeTimers();
    try {
      render(
        <ShipDiagram
          parts={partsOf(lfv2WaveProbe as Fixture)}
          width={600}
          height={700}
        />,
      );
      const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
      fireEvent.pointerDown(icon, { pointerType: "touch" });
      fireEvent.pointerUp(icon, { pointerType: "touch" });
      expect(icon.getAttribute("aria-expanded")).toBe("true");
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      fireEvent.click(icon);
      expect(icon.getAttribute("aria-expanded")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles on a click with no pointerdown long after a touch tap whose click never came", () => {
    vi.useFakeTimers();
    try {
      render(
        <ShipDiagram
          parts={partsOf(lfv2WaveProbe as Fixture)}
          width={600}
          height={700}
        />,
      );
      const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
      fireEvent.pointerDown(icon, { pointerType: "touch" });
      fireEvent.pointerUp(icon, { pointerType: "touch" });
      expect(icon.getAttribute("aria-expanded")).toBe("true");
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      fireEvent.click(icon);
      expect(icon.getAttribute("aria-expanded")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggles on a mouse click that follows an earlier touch tap", () => {
    render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    fireEvent.pointerUp(icon, { pointerType: "touch" });
    fireEvent.click(icon);
    fireEvent.pointerDown(icon, { pointerType: "mouse" });
    fireEvent.pointerUp(icon, { pointerType: "mouse" });
    fireEvent.click(icon);
    expect(icon.getAttribute("aria-expanded")).toBe("false");
  });

  it("lays the box out inside a phone-width viewport", () => {
    const wide = window.innerWidth;
    window.innerWidth = 360;
    try {
      render(
        <ShipDiagram
          parts={partsOf(lfv2WaveProbe as Fixture)}
          width={300}
          height={500}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Expand the 9 parts/ }),
      );
      const box = document.body.querySelector('[data-role="cluster-box"]');
      expect(Number(box?.getAttribute("width"))).toBeLessThanOrEqual(360 - 16);
    } finally {
      window.innerWidth = wide;
    }
  });

  it("has no accessibility violations with the box open", async () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    await expectNoA11yViolations(container);
  });
});
