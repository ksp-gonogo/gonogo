import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
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
          // Avoids the belt/location badge falling back to "Unshielded",
          // whose text otherwise substring-collides with the "Shielded"
          // readout query below.
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

  it("shows the inner-belt badge as the most severe location fact when active", () => {
    render(
      <RadiationSection
        weather={{ innerBelt: true, outerBelt: true, magnetosphere: true }}
        utNow={10}
      />,
    );
    expect(screen.getByText("Inner belt")).toBeInTheDocument();
    expect(screen.getByText("Outer belt")).toBeInTheDocument();
  });

  it("falls back to a magnetosphere/unshielded badge outside any belt", () => {
    const { rerender } = render(
      <RadiationSection weather={{ magnetosphere: true }} utNow={10} />,
    );
    expect(screen.getByText("Magnetosphere")).toBeInTheDocument();

    rerender(
      <RadiationSection weather={{ magnetosphere: false }} utNow={10} />,
    );
    expect(screen.getByText("Unshielded")).toBeInTheDocument();
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
