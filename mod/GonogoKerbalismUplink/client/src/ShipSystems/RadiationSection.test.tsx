import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-testing";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  doseRateDecimals,
  niceCeil,
  pushRadiationSample,
  RADIATION_WINDOW_SEC,
  type RadiationSample,
  RadiationSection,
} from "./RadiationSection";

// ---------------------------------------------------------------------------
// pushRadiationSample: pure buffer management, no React involved.
// ---------------------------------------------------------------------------

function sample(ut: number, ambient = 0, shielded = 0): RadiationSample {
  return { ut, ambientRadPerSec: ambient, shieldedRadPerSec: shielded };
}

describe("pushRadiationSample", () => {
  it("appends the first sample to an empty buffer", () => {
    const result = pushRadiationSample([], sample(0));
    expect(result).toEqual([sample(0)]);
  });

  it("throttles: drops a sample that hasn't advanced past the min UT gap", () => {
    const buf = pushRadiationSample([], sample(0));
    const next = pushRadiationSample(buf, sample(1), 600, 2);
    // Same reference: React's setState bails on an unchanged reference.
    expect(next).toBe(buf);
  });

  it("accepts a sample once it clears the min UT gap", () => {
    const buf = pushRadiationSample([], sample(0));
    const next = pushRadiationSample(buf, sample(2), 600, 2);
    expect(next).toEqual([sample(0), sample(2)]);
  });

  it("trims samples older than the window, relative to the newest sample", () => {
    let buf: readonly RadiationSample[] = [];
    for (let ut = 0; ut <= 20; ut += 5) {
      buf = pushRadiationSample(buf, sample(ut), 10, 2);
    }
    // Window 10: only samples within [newest-10, newest] survive.
    expect(buf.map((s) => s.ut)).toEqual([10, 15, 20]);
  });

  it("resets the buffer on a rewind past sampling jitter (quickload/scrub)", () => {
    const buf = pushRadiationSample(
      pushRadiationSample([], sample(100)),
      sample(110),
      RADIATION_WINDOW_SEC,
      2,
    );
    const rewound = pushRadiationSample(
      buf,
      sample(5),
      RADIATION_WINDOW_SEC,
      2,
    );
    expect(rewound).toEqual([sample(5)]);
  });
});

describe("niceCeil", () => {
  it("steps up a 1-2-2.5-5-10 ladder", () => {
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.3)).toBe(2);
    expect(niceCeil(2.2)).toBe(2.5);
    expect(niceCeil(3.1)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(21.9)).toBe(25);
    expect(niceCeil(60)).toBe(100);
  });

  it("floors degenerate input at 1 rather than a broken domain", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(Number.NaN)).toBe(1);
  });
});

describe("doseRateDecimals", () => {
  it("keeps a stable digit budget per decade", () => {
    expect(doseRateDecimals(216)).toBe(0);
    expect(doseRateDecimals(21.6)).toBe(1);
    expect(doseRateDecimals(2.16)).toBe(2);
    expect(doseRateDecimals(0.216)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// RadiationSection component
// ---------------------------------------------------------------------------

const CARRIED = ["kerbalism.spaceweather"];

const renderedTrees: Array<() => void> = [];

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  fixture.client.subscribe("kerbalism.spaceweather", () => {});
  return fixture;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("RadiationSection", () => {
  it("renders nothing before any spaceweather frame has landed", () => {
    const { container } = render(
      <RadiationSection weather={undefined} utNow={10} />,
    );
    renderedTrees.push(() => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the ambient and shielded readouts through the canonical Unit renderer", () => {
    render(
      <RadiationSection
        weather={{
          radiationRadPerSecond: 0.006,
          habitatRadiationRadPerSecond: 0.00006,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    // Both readouts render through <Unit>, not a hand-rolled string: its
    // own unit symbol lands beside the number as a distinct element.
    const unitEls = document.querySelectorAll("[data-unit]");
    expect(unitEls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Ambient", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Shielded", { exact: false })).toBeInTheDocument();
  });

  it("renders the graph as a sparkline with no in-frame lines at all", () => {
    const { container } = render(
      <RadiationSection
        weather={{
          radiationRadPerSecond: 0.006,
          habitatRadiationRadPerSecond: 0.00006,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    // No quarter gridlines (sparkline) and no SVG threshold rule either:
    // the safe threshold renders as a fixed HTML tick outside the viewBox.
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("marks the safe threshold as a fixed tick labelled with its own level", () => {
    const { container } = render(
      <RadiationSection
        weather={{
          // Quiet cruise, 0.36 rad/h ambient: the domain floors at twice
          // the threshold, so the 0.5 marker sits exactly mid-frame.
          radiationRadPerSecond: 0.0001,
          habitatRadiationRadPerSecond: 0.00001,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    const marker = container.querySelector<HTMLElement>(
      '[data-threshold-marker="safe"]',
    );
    expect(marker).not.toBeNull();
    // The "0.5" level reads beside the tick, an axis annotation rather
    // than a rule across the frame.
    expect(marker?.textContent).toBe("0.5");
    // The domain is clamped to [0, 2*threshold] on a quiet reading, so the
    // marker sits mid-frame, not crawling with the data extent.
    expect(marker?.style.top).toBe("50%");
  });

  it("wears identity hues at rest and escalates only above the threshold", () => {
    const quiet = render(
      <RadiationSection
        weather={{
          // 0.0001 rad/s = 0.36 rad/h ambient: under the 0.5 threshold.
          radiationRadPerSecond: 0.0001,
          habitatRadiationRadPerSecond: 0.00001,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    const quietAmbient = screen.getByText("Ambient", { exact: false });
    // No alarm styling in quiet cruise: the warning-tone override is absent.
    expect(quietAmbient.getAttribute("style")).toBeNull();
    quiet.unmount();

    render(
      <RadiationSection
        weather={{
          // 0.006 rad/s = 21.6 rad/h ambient: well over the threshold.
          radiationRadPerSecond: 0.006,
          habitatRadiationRadPerSecond: 0.00006,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    const hotAmbient = screen.getByText("Ambient", { exact: false });
    expect(hotAmbient.getAttribute("style")).toContain(
      "--color-status-warning-fg-muted",
    );
  });

  it("rounds dose readouts to magnitude-aware decimals, not a fixed four", () => {
    render(
      <RadiationSection
        weather={{
          // 21.6 rad/h ambient, 0.216 rad/h shielded.
          radiationRadPerSecond: 0.006,
          habitatRadiationRadPerSecond: 0.00006,
          magnetosphere: true,
        }}
        utNow={10}
      />,
    );
    expect(screen.getByText("Ambient", { exact: false }).textContent).toContain(
      "21.6",
    );
    expect(
      screen.getByText("Shielded", { exact: false }).textContent,
    ).toContain("0.216");
    expect(document.body.textContent).not.toContain("21.6000");
  });

  it("names the belt(s) as plain text under the graph, never a badge", () => {
    render(
      <RadiationSection
        weather={{ innerBelt: true, outerBelt: true, magnetosphere: true }}
        utNow={10}
      />,
    );
    // Belt location is a neutral status fact, not an alert: no Badge/pill
    // renders for it, just the plain text line naming both belts.
    const location = screen.getByText("Inner belt · Outer belt");
    expect(location).toBeInTheDocument();
    expect(location.tagName).toBe("SPAN");
  });

  it("falls back to magnetosphere, then none, outside any belt", () => {
    const { rerender } = render(
      <RadiationSection weather={{ magnetosphere: true }} utNow={10} />,
    );
    expect(screen.getByText("Magnetosphere")).toBeInTheDocument();

    rerender(
      <RadiationSection weather={{ magnetosphere: false }} utNow={10} />,
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("builds a rolling history off the live stream as UT advances", async () => {
    const fixture = newFixture();
    let setUtRef: ((n: number) => void) | undefined;
    function Harness() {
      const [ut, setUt] = useState(10);
      const weather = useTelemetry("kerbalism.spaceweather");
      useEffect(() => {
        setUtRef = setUt;
      }, []);
      return <RadiationSection weather={weather} utNow={ut} />;
    }
    const result = render(
      <fixture.Provider>
        <Harness />
      </fixture.Provider>,
    );
    renderedTrees.push(result.unmount);

    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.001,
        habitatRadiationRadPerSecond: 0.00002,
      });
    });
    await screen.findByText("Collecting radiation history…");

    act(() => {
      setUtRef?.(20);
    });
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: 0.002,
        habitatRadiationRadPerSecond: 0.00004,
      });
    });

    // Two distinct-UT samples landed: the "collecting" placeholder clears
    // and a real trace renders.
    await screen.findByRole("img", { name: /Radiation dose rate trend/ });
    expect(
      screen.queryByText("Collecting radiation history…"),
    ).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RadiationSection
        weather={{
          radiationRadPerSecond: 0.006,
          habitatRadiationRadPerSecond: 0.00006,
          outerBelt: true,
        }}
        utNow={10}
      />,
    );
    renderedTrees.push(() => {});
    expect(await axe(container)).toHaveNoViolations();
  });
});
