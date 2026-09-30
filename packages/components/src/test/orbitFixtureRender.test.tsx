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
 * The five widgets that ask the propagation seam what to draw, rendered
 * against their own fixtures, asserting none of them refuses. On the render,
 * since only mounting shows the widget consulted the horizon, and on the
 * refusal copy, the one thing all five say and only when the seam declined.
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
 * The biggest mode that does not override config: a small cell renders no
 * diagram, so a refusal there is invisible. MapView's config modes pin a body
 * the vessel is not at, removing the track for another reason.
 */
function drawingMode(modes: readonly WidgetSnapshotMode[]): WidgetSnapshotMode {
  const plain = modes.filter((m) => m.config === undefined);
  const pool = plain.length > 0 ? plain : modes;
  return pool.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
}

/**
 * Settle the stream emits, the sized ResizeObserver's timeout and the
 * provider's frame, inside `act` because the view clock keeps ticking.
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
