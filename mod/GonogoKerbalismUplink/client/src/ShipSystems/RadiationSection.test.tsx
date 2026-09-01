import { useTelemetry, value } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
  fixture.subscribe("kerbalism.spaceweather");
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
          radiationRadPerSecond: value("rad/s", 0.006),
          habitatRadiationRadPerSecond: value("rad/s", 0.00006),
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
          radiationRadPerSecond: value("rad/s", 0.006),
          habitatRadiationRadPerSecond: value("rad/s", 0.00006),
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
          radiationRadPerSecond: value("rad/s", 0.0001),
          habitatRadiationRadPerSecond: value("rad/s", 0.00001),
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
          radiationRadPerSecond: value("rad/s", 0.0001),
          habitatRadiationRadPerSecond: value("rad/s", 0.00001),
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
          radiationRadPerSecond: value("rad/s", 0.006),
          habitatRadiationRadPerSecond: value("rad/s", 0.00006),
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
          radiationRadPerSecond: value("rad/s", 0.006),
          habitatRadiationRadPerSecond: value("rad/s", 0.00006),
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
      // The PAYLOAD, not the Reading. Every field on
      // `KerbalismSpaceWeather` is optional, so a `Reading` is structurally
      // assignable to it and the hook's own return value typechecked as a
      // weather frame while carrying none of its fields. The section then read
      // absence at every arm, which it used to render as 0 rad/s, so this
      // harness drove a live trend off two samples that measured nothing.
      const reading = useTelemetry("kerbalism.spaceweather");
      const weather =
        reading.state === "observed"
          ? reading.value
          : reading.state === "reckonable"
            ? reading.reckoned.value
            : undefined;
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
          radiationRadPerSecond: value("rad/s", 0.006),
          habitatRadiationRadPerSecond: value("rad/s", 0.00006),
          outerBelt: true,
        }}
        utNow={10}
      />,
    );
    renderedTrees.push(() => {});
    await expectNoA11yViolations(container);
  });
});

describe("RadiationSection: a frame that carries no dose rate", () => {
  it("reads the ambient dose as absent, never as zero radiation", () => {
    render(
      <RadiationSection
        weather={{ magnetosphere: true, inSunlight: true }}
        utNow={10}
      />,
    );
    renderedTrees.push(() => {});
    const ambient = screen.getByText("Ambient", { exact: false });
    expect(ambient.textContent).toContain(NULL_DISPLAY);
    expect(ambient.textContent).not.toMatch(/\b0(\.0+)?\s*(rad|mrad|µrad)/);
  });

  it("reads the shielded dose as absent when neither figure is reported", () => {
    render(
      <RadiationSection
        weather={{ magnetosphere: true, inSunlight: true }}
        utNow={10}
      />,
    );
    renderedTrees.push(() => {});
    const shielded = screen.getByText("Shielded", { exact: false });
    expect(shielded.textContent).toContain(NULL_DISPLAY);
  });

  it("plots no trend point for a dose rate nobody reported", () => {
    const buffer = pushRadiationSample([], {
      ut: 0,
      ambientRadPerSec: null,
      shieldedRadPerSec: null,
    });
    expect(buffer).toEqual([]);
  });
});
