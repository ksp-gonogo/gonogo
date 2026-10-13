import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import "../index";
import { renderWidgetMode } from "../test/widgetDomSnapshot";

/**
 * MapView's predicted ground track, rendered from the fixtures. The track is
 * on a canvas, so the published segment count is the only inspectable trace:
 * a starved prediction and a refused one are otherwise the same blank canvas.
 * A fixture meaning to have no chain says so in `_meta.patchesAbsent`.
 */

const FIXTURES = import.meta.glob<{ default: Record<string, unknown> }>(
  "./__fixtures__/*.json",
  { eager: true },
);

interface Fixture {
  _meta?: { patchesAbsent?: string };
  _stream?: { stopsArriving?: boolean; emits?: Array<{ channel?: string }> };
}

/** The registered default size. A tiny cell renders no map at all, so a zero there says nothing. */
const MODE = { name: "default-12x18", w: 12, h: 18 };

function segments(container: HTMLElement): number {
  const el = container.querySelector("[data-prediction-segments]");
  // -1 for an absent layer: "drew nothing" and "no layer mounted" are different failures.
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
    /* A scene the link drops out of is judged by `staleScenes.test.tsx`. */
    if (fixture._stream?.stopsArriving === true) continue;

    const absent = fixture._meta?.patchesAbsent;
    it(`${slug} ${absent ? "draws no track, and says why in the fixture" : "draws a track"}`, async () => {
      const { container, teardown } = await renderWidgetMode({
        Widget,
        fixture: mod.default,
        mode: MODE,
      });
      try {
        await settle();
        // `toBeGreaterThan(0)` catches both zero and the -1 of no layer.
        if (absent === undefined)
          expect(segments(container)).toBeGreaterThan(0);
        else expect(segments(container)).toBe(0);
      } finally {
        teardown();
      }
    });
  }
});
