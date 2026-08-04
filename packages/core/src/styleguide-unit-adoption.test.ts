import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Declining ratchet: a unit symbol must reach a reader through `<Unit>`, not
 * by being typed next to a number.
 *
 * This guard used to count one narrow shape, `` `${value} ${symbol}` ``, the
 * exact way eleven call sites had been rejoining `formatQuantity`'s two parts
 * into a string. That shape is gone, and so is `formatQuantity` from the
 * package's public surface: a widget cannot import a formatter from `ui-kit`
 * any more, because the only two it exports are `speakQuantity` (an
 * accessible name) and `writeQuantity` (visible text that is MEASURED, an SVG
 * label or a canvas, where a node cannot go).
 *
 * Counting formatter imports would therefore read zero and prove nothing.
 * The failure mode that outlived the API change is simpler and older: a
 * widget writes the symbol itself.
 *
 *     `${closingMagnitude.toFixed(1)} m/s`
 *
 * Nothing in the type system objects. It renders correctly. And it is the
 * whole problem the unit layer exists to solve, one site at a time: the
 * symbol cannot be dimmed, cannot be kept off a line break, is announced to a
 * screen reader as the letters "m", "slash", "s", and does not follow when a
 * value's ladder rung changes. Eleven widgets each grew their own ladder that
 * way once already.
 *
 * So this counts the symbol being typed, not the formatter being imported.
 *
 * **What counts as an offender**: a template interpolation immediately
 * followed by a unit symbol. **What does not**: `speakQuantity` and
 * `writeQuantity`, whose whole purpose is to produce that string in the two
 * places a node cannot go, and CSS lengths (`width: ${pct}%`), which are not
 * a reader-facing quantity at all.
 */

// A `${…}` interpolation, then optionally one space, then a unit symbol that
// ends at a non-word boundary. Every offender takes this shape.
const SYMBOL =
  "m/s²|m/s|km/h|km|Mm|Gm|mm|cm|kPa|MPa|kN|MN|kW|MW|GW|kg|°C|°|%|m|s|t|N|W|f|sci|rep|Mit|deg|rad";
const TYPED_SYMBOL = String.raw`\}\s?(${SYMBOL})([^A-Za-z0-9_/]|\x60|$)`;

// A CSS length is not a readout. `width: ${pct}%` and its friends are the
// dominant false positive and would otherwise drown the real ones.
const CSS_PROPERTY =
  /(width|height|left|top|right|bottom|transform|translate|inset|margin|padding|gap|flex|stroke|offset|dasharray|dashoffset)\s*[:(]/i;

/**
 * Per-file counts of the symbols still typed by hand.
 *
 * These fall into three groups, and all three are real work rather than noise:
 *
 * - **SVG and canvas labels** (`ManeuverPreview`, `SystemDiagram`,
 *   `DescentEnvelope`, `Navball`, `AttitudeIndicator`): an SVG `<text>`
 *   cannot contain a `<span>`, so these want `writeQuantity`, which is a
 *   mechanical change once each one's ladder is checked.
 * - **Ordinary readouts** (`DistanceToTarget`, `PowerSystems`,
 *   `TransferWindow`, the app's alarm and outcome banners): these want
 *   `<Unit>`, and each is a small edit plus whatever assertions name the
 *   old string.
 * - **`title` attributes** (`SpaceCenterStatus`'s tiny funds row): an
 *   attribute cannot hold a node either, and these want `speakQuantity`,
 *   which spells the unit out as a word. Strategies' own tiny row was one
 *   of these and has already moved.
 *
 * To lower an entry: convert the site, update its callers and assertions,
 * and drop the count. Never raise one.
 */
const BASELINE: Record<string, number> = {
  "packages/app/src/alarms/AlarmsModal.tsx": 5,
  "packages/app/src/components/FlightOutcomeBanner.tsx": 3,
  "packages/app/src/goNoGo/GoNoGoComponent.tsx": 2,
  "packages/app/src/missionProfiles/MissionProfilesModal.tsx": 2,
  "packages/components/src/AtmosphereProfile/index.tsx": 1,
  "packages/components/src/CommSignal/index.tsx": 1,
  "packages/components/src/ContractManager/index.tsx": 1,
  "packages/components/src/CrewManifest/index.tsx": 1,
  "packages/components/src/DeployedScience/index.tsx": 1,
  "packages/components/src/FuelStatus/index.tsx": 3,
  "packages/components/src/GroundSurvey/index.tsx": 2,
  "packages/components/src/LandingStatus/AltitudeRail.tsx": 1,
  "packages/components/src/LandingStatus/DescentEnvelope.tsx": 1,
  "packages/components/src/LandingStatus/TouchdownReticle.tsx": 2,
  "packages/components/src/LandingStatus/index.tsx": 2,
  "packages/components/src/LaunchDirector/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/PresetInput.tsx": 5,
  "packages/components/src/MapView/MapPoiLayer.tsx": 1,
  "packages/components/src/MechJeb/index.tsx": 2,
  "packages/components/src/PerfBudgets/index.tsx": 1,
  "packages/components/src/RotorTachometer/index.tsx": 3,
  "packages/components/src/ShipMap/ShipDiagram.tsx": 1,
  "packages/components/src/SpaceCenterStatus/index.tsx": 1,
  "packages/components/src/Strategies/index.tsx": 1,
  "packages/components/src/SystemView/AlmanacPanel.tsx": 2,
  "packages/components/src/TargetPicker/index.tsx": 1,
  "packages/components/src/TechTree/index.tsx": 1,
  "packages/components/src/Twr/index.tsx": 1,
  "packages/data/src/FlightsManager/index.tsx": 1,
  "packages/serial/src/VirtualDevice/AnalogPad.tsx": 1,
  "packages/ui-kit/src/CommandDelay/CameraSetpointInput.tsx": 1,
  "packages/ui-kit/src/CommandDelay/ControlDelayStream.tsx": 2,
};

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function countsByFile(root: string): Record<string, number> {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "grep",
        "-n",
        "-E",
        TYPED_SYMBOL,
        "--",
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches anywhere, which is the goal state.
    if ((err as { status?: number }).status === 1) return {};
    throw err;
  }
  const counts: Record<string, number> = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const [file, , ...rest] = line.split(":");
    if (file.includes(".test.") || file.includes("/dist/")) continue;
    if (CSS_PROPERTY.test(rest.join(":"))) continue;
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));
const counts = countsByFile(root);

describe("design-system: units reach a reader through <Unit>", () => {
  it("adds no new place that types a unit symbol next to a number", () => {
    const added: string[] = [];
    for (const [file, count] of Object.entries(counts)) {
      const allowed = BASELINE[file] ?? 0;
      if (count > allowed) {
        added.push(`  ${file}: ${count} (baseline ${allowed})`);
      }
    }
    if (added.length > 0) {
      throw new Error(
        "A unit symbol was typed next to a number. Render " +
          "<Unit value={x} /> instead, so the symbol keeps its styling, " +
          "follows the value's ladder, and is announced as a word rather " +
          "than as letters. Where a string is genuinely required: " +
          "speakQuantity for an accessible name, writeQuantity for visible " +
          `text that is measured (an SVG label, a canvas).\n${added.join("\n")}`,
      );
    }
    expect(added).toEqual([]);
  });

  it("has no stale baseline entry", () => {
    // A file that got converted must leave the list, or the ratchet stops
    // ratcheting: it would silently allow a hand-typed symbol to come back.
    const stale = Object.keys(BASELINE).filter(
      (file) => (counts[file] ?? 0) < BASELINE[file],
    );
    if (stale.length > 0) {
      throw new Error(
        "These are below their baseline, which is good. Lower or remove the " +
          `entry in BASELINE so the gain is locked in:\n${stale
            .map(
              (f) => `  ${f}: now ${counts[f] ?? 0}, baseline ${BASELINE[f]}`,
            )
            .join("\n")}`,
      );
    }
    expect(stale).toEqual([]);
  });
});
