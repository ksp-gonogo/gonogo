import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

function mountMicro(attitude: {
  heading: number;
  pitch: number;
  roll: number;
}) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nb-micro" }}>
        <NavballComponent config={{}} id="nb-micro" w={4} h={3} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.attitude", {
      ...attitude,
      headingRootFrame: attitude.heading,
      pitchRootFrame: attitude.pitch,
      rollRootFrame: attitude.roll,
    });
  });
  return { fixture, ...rendered };
}

const lines = () =>
  [...document.querySelectorAll("[data-attitude-line]")].map((line) => ({
    label: line.querySelector("[data-attitude-label]")?.textContent,
    sign: line.querySelector("[data-attitude-sign]")?.textContent,
    figure: line.querySelector("[data-attitude-figure]")?.textContent,
  }));

describe("Navball at its smallest body tile", () => {
  it("shows heading, pitch and roll as three labelled figures with signed pitch and roll", async () => {
    const { container } = mountMicro({ heading: 90, pitch: 45, roll: 0 });

    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(lines().map(({ label, sign }) => [label, sign])).toEqual([
      ["HDG", ""],
      ["PCH", "+"],
      ["RLL", "+"],
    ]);
    expect(visibleText(container)).toMatch(/90/);
    expect(document.querySelector("svg[role=img]")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("puts a negative angle's sign in the sign column and its magnitude in the figure", async () => {
    mountMicro({ heading: 270, pitch: -60, roll: 10 });

    await waitFor(() => expect(lines()).toHaveLength(3));
    const [, pitch] = lines();
    expect(pitch.sign).toBe("−");
    expect(pitch.figure).toMatch(/^60/);
  });

  it("keeps the same columns whatever the digits, so a changing angle does not move the line", async () => {
    mountMicro({ heading: 5, pitch: -5, roll: 180 });

    await waitFor(() => expect(lines()).toHaveLength(3));
    for (const part of ["label", "sign", "figure"] as const) {
      const widths = new Set(
        [...document.querySelectorAll(`[data-attitude-${part}]`)].map(
          (el) =>
            (el as HTMLElement).style.width ||
            (el as HTMLElement).style.minWidth,
        ),
      );
      expect(widths.size).toBe(1);
    }
  });

  it("marks each held figure when the link drops", async () => {
    const { fixture } = mountMicro({ heading: 90, pitch: 45, roll: 0 });
    await waitFor(() => expect(lines()).toHaveLength(3));

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(document.querySelectorAll("[data-held-mark]")).toHaveLength(3),
    );
    expect(document.querySelectorAll("[data-unit-currency]")).toHaveLength(3);
  });

  it("draws the no-data token, never a zero, for an angle that has not arrived", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nb-micro-none" }}>
          <NavballComponent config={{}} id="nb-micro-none" w={4} h={3} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(lines().map((line) => line.figure)).toEqual([
      NULL_DISPLAY,
      NULL_DISPLAY,
      NULL_DISPLAY,
    ]);
    expect(lines().map((line) => line.sign)).toEqual(["", "", ""]);
    // The reason sits in a tooltip, since a caption under three lines does not fit the tile.
    expect(
      document.querySelector("[data-tooltip='Waiting for attitude telemetry']"),
    ).not.toBeNull();
    expect(visibleText()).not.toMatch(/waiting for attitude/i);
  });
});
