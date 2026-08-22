import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
// Importing the package index self-registers every built-in component.
import "../index";
import { trajectoryWithheldCopy } from "../shared/trajectoryWithheld";
import { renderWidgetMode, type WidgetSnapshotMode } from "./widgetDomSnapshot";

/**
 * The five widgets that ask the propagation seam what to draw, rendered against
 * their own fixtures, asserting that none of them ends up refusing.
 *
 * Written against the RENDER rather than against the fixture JSON, and separate
 * from `orbitFixtureHorizon.test.ts` for that reason: that one can tell whether
 * the field is present, and cannot tell whether the widget consulted it. A
 * fixture can carry a horizon the widget never reads, and a widget can read one
 * a fixture never delivered because the harness dropped the emit. Only mounting
 * it says which.
 *
 * It asserts on the REFUSAL COPY rather than on a drawn element, because the
 * five widgets draw five different things (an ellipse, a polyline, a canvas
 * layer) and a per-widget shape assertion would be five assertions that each
 * pass for the wrong reason when a widget stops drawing for some other cause.
 * The refusal text is the one thing all five say, and it is said only when the
 * seam declined.
 */

const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__fixtures__/*.json",
  { eager: true },
);

/** The widgets whose drawing is authorised by `useOrbitTrajectory`. */
const SEAM_WIDGETS = [
  "orbit-view",
  "current-orbit",
  "map-view",
  "system-view",
  "maneuver-planner",
] as const;

/** Every heading `trajectoryWithheldCopy` can produce, so a new reason cannot slip past. */
const REFUSAL_HEADINGS = (
  [
    { shape: "withheld", reason: "no-horizon-stated" },
    { shape: "withheld", reason: "past-horizon" },
    { shape: "withheld", reason: "shape-not-stated" },
    { shape: "withheld", reason: "no-arc-available" },
  ] as const
).map((w) => trajectoryWithheldCopy(w).heading);

function fixturesFor(
  fixturesPath: string,
): Array<[string, Record<string, unknown>]> {
  const needle = `../${fixturesPath}/`;
  return Object.entries(FIXTURE_MODULES)
    .filter(([path]) => path.startsWith(needle))
    .map(
      ([path, mod]) =>
        [path.slice(needle.length), mod.default] as [
          string,
          Record<string, unknown>,
        ],
    );
}

/**
 * The biggest mode that does not override config.
 *
 * Size matters because these widgets size-gate the drawing itself: a 3x3 cell
 * renders the status pill and no diagram at all, so a refusal there is
 * invisible and the assertion would pass on a widget that draws nothing. The
 * config-carrying modes are skipped because MapView's last one pins the map to
 * a body the vessel is not at, which removes the track for a reason that has
 * nothing to do with the horizon.
 */
function drawingMode(modes: readonly WidgetSnapshotMode[]): WidgetSnapshotMode {
  const plain = modes.filter((m) => m.config === undefined);
  const pool = plain.length > 0 ? plain : modes;
  return pool.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
}

/**
 * Settle the stream emits, the sized ResizeObserver's timeout and the
 * provider's rAF frame.
 *
 * Inside `act` because these widgets keep updating across the wait: the view
 * clock ticks and the observer's size lands a frame or two in, and an update
 * landing on an unwrapped frame is a warning the whole tree is currently free
 * of.
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  });
}

describe("widgets draw the trajectories their fixtures authorise", () => {
  for (const widgetId of SEAM_WIDGETS) {
    const widget = listWidgets().find((w) => w.widgetId === widgetId);
    const def = getComponent(widgetId);
    if (!widget || !def) {
      it(`${widgetId} is registered and listed`, () => {
        expect({
          widget: widget !== undefined,
          def: def !== undefined,
        }).toEqual({ widget: true, def: true });
      });
      continue;
    }
    const Widget = def.component as Parameters<
      typeof renderWidgetMode
    >[0]["Widget"];
    const fixtures = fixturesFor(widget.fixturesPath);
    const mode = drawingMode(
      widget.modes.length > 0
        ? widget.modes
        : [{ name: "default", w: 6, h: 6 }],
    );

    describe(widgetId, () => {
      it("has fixtures to render, so an empty sweep cannot pass as a clean one", () => {
        expect(fixtures.length).toBeGreaterThan(0);
      });

      for (const [fixtureName, fixture] of fixtures) {
        const slug = fixtureName.replace(/\.json$/, "");
        it(`${slug} is not refused`, async () => {
          const { container, teardown } = await renderWidgetMode({
            Widget,
            fixture,
            mode,
          });
          try {
            await settle();
            const text = visibleText(container);
            expect(REFUSAL_HEADINGS.filter((h) => text.includes(h))).toEqual(
              [],
            );
          } finally {
            teardown();
          }
        });
      }
    });
  }
});
