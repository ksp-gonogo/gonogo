import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import "../index";
import { renderWidgetMode } from "../test/widgetDomSnapshot";

/**
 * MapView's predicted ground track, rendered from the fixtures rather than from
 * a hand-built sample.
 *
 * The track is drawn to a `<canvas>`, so nothing about it is inspectable except
 * the segment count the layer publishes. That is the whole reason the count is
 * on the element: a fixture that starves the prediction and a widget that
 * refuses to draw one produce the same blank canvas, and every check that could
 * only see pixels read both as fine.
 *
 * Which is what happened. Every fixture reached the widget with an empty patch
 * chain, so the prediction path had no coverage at all here, in the a11y sweep
 * or in the playwright probe: three harnesses reading the same four files, none
 * of them able to say the track was missing.
 *
 * `_meta.patchesAbsent` is the way a fixture says it means to have no chain,
 * and the reason lives in the fixture rather than in a list here so that the
 * next person to look at the file finds it there.
 */

const FIXTURES = import.meta.glob<{ default: Record<string, unknown> }>(
  "./__fixtures__/*.json",
  { eager: true },
);

interface Fixture {
  _meta?: { patchesAbsent?: string };
  _stream?: { emits?: Array<{ channel?: string }> };
}

/** The registered default size. A tiny cell renders no map at all, so a zero there says nothing. */
const MODE = { name: "default-12x18", w: 12, h: 18 };

function segments(container: HTMLElement): number {
  const el = container.querySelector("[data-prediction-segments]");
  // -1 rather than 0 for an absent layer: "the layer drew nothing" and "no
  // layer mounted" are different failures and must not share a number.
  return Number(el?.getAttribute("data-prediction-segments") ?? "-1");
}

/** Settle the emits, the sized `ResizeObserver` and the provider's frame, inside `act`. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  });
}

describe("MapView predicts a ground track from its fixtures", () => {
  const def = getComponent("map-view");
  const config = getWidget("map-view");
  const Widget = def?.component as Parameters<
    typeof renderWidgetMode
  >[0]["Widget"];

  it("is registered and listed, so an unresolved widget cannot pass as a clean sweep", () => {
    expect({ def: def !== undefined, config: config !== undefined }).toEqual({
      def: true,
      config: true,
    });
  });

  for (const [path, mod] of Object.entries(FIXTURES)) {
    const fixture = mod.default as Fixture;
    const slug = path.replace("./__fixtures__/", "").replace(/\.json$/, "");
    const emitsOrbit =
      fixture._stream?.emits?.some((e) => e?.channel === "vessel.orbit") ??
      false;
    if (!emitsOrbit) continue;

    const absent = fixture._meta?.patchesAbsent;
    it(`${slug} ${absent ? "draws no track, and says why in the fixture" : "draws a track"}`, async () => {
      const { container, teardown } = await renderWidgetMode({
        Widget,
        fixture: mod.default,
        mode: MODE,
      });
      try {
        await settle();
        // Zero and "no layer" are both failures for a fixture carrying a
        // chain, and `toBeGreaterThan(0)` catches the -1 too.
        if (absent === undefined)
          expect(segments(container)).toBeGreaterThan(0);
        else expect(segments(container)).toBe(0);
      } finally {
        teardown();
      }
    });
  }
});
