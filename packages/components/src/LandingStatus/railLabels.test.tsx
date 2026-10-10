import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  integrateAtmosphere,
  LOW_DESCENT,
} from "../../scripts/landingAtmosphereModel";
import {
  type Frame,
  integrate,
  SHALLOW_DESCENT,
} from "../../scripts/landingDescentModel";
import { AltitudeRail } from "./AltitudeRail";

/**
 * The altitude rail's scale across every height each story passes through: no two tick labels on it may read the same, which a scale written in kilometres at one decimal does as soon as its ticks are 50 m apart.
 */
const STORIES: readonly [string, readonly Frame[]][] = [
  ["the crash", integrate({ crash: true })],
  ["the safe landing", integrate()],
  ["the shallow approach", integrate({ start: SHALLOW_DESCENT })],
  ["the atmospheric approach", integrateAtmosphere({ ocean: false })],
  ["the ocean landing", integrateAtmosphere({ ocean: true }, LOW_DESCENT)],
];

function observed(m: number): Reading<Value<"m">> {
  return {
    state: "observed",
    value: value("m", m),
    atUt: value("ut", 100),
    reckoning: { status: "none" },
  };
}

/** The scale's tick labels as drawn: its numbers, not the unit written once above them. */
function tickLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="meter"] text[font-size="8"]')]
    .map((t) => t.textContent ?? "")
    .filter((text) => /^-?[\d.,]+$/.test(text));
}

describe.each(STORIES)("the altitude rail through %s", (_name, frames) => {
  it("never writes two ticks the same", () => {
    let checked = 0;
    for (const f of frames.filter((frame) => !frame.landed)) {
      const { container, unmount } = render(
        <AltitudeRail
          agl={observed(f.aglMeters)}
          verticalSpeed={-f.vDown}
          ignitionAltitude={null}
          suicideBurnCountdown={null}
        />,
      );
      const labels = tickLabels(container);
      expect(
        new Set(labels).size,
        `at ${f.aglMeters.toFixed(0)} m: ${labels.join(", ")}`,
      ).toBe(labels.length);
      checked += labels.length > 1 ? 1 : 0;
      unmount();
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("the altitude rail at every height a story passes through", () => {
  it("never writes two ticks the same, from the ground to 25 km and from a hover to 200 m/s", () => {
    const repeats: string[] = [];
    for (let h = 10; h <= 25_000; h += h < 3_000 ? 10 : 100) {
      for (const vs of [-200, -60, -20, -6, -1, 0]) {
        // Sea level below the ground puts ticks under it, as over Kerbin's land and the Mun's site.
        for (const sea of [null, -120, -250]) {
          const { container, unmount } = render(
            <AltitudeRail
              agl={observed(h)}
              verticalSpeed={vs}
              seaLevel={sea === null ? null : value("m", sea)}
              ignitionAltitude={null}
              suicideBurnCountdown={null}
            />,
          );
          const labels = tickLabels(container);
          if (new Set(labels).size !== labels.length) {
            repeats.push(`${h} m at ${vs} m/s: ${labels.join(", ")}`);
          }
          // A zero tick reads 0; one below the ground reads its real value, never "-0".
          for (const label of labels.filter((l) => /^-0(\.0*)?$/.test(l))) {
            repeats.push(`${h} m at ${vs} m/s, sea ${sea}: ${label}`);
          }
          unmount();
        }
      }
    }
    expect(repeats).toEqual([]);
  });
});
