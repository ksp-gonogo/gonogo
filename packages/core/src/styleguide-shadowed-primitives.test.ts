import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: nothing declares a local component under a name the
 * kit already publishes.
 *
 * Its sibling `styleguide-duplicate-primitives.test.ts` catches the same
 * component implemented in both shared packages. This catches the quieter
 * version: a widget that builds its own and calls it by the kit's name.
 *
 * `Navball` did exactly this. It had a local
 * `const ToggleButton = styled.button<{ $active: boolean }>` and used it for
 * SAS, RCS, precision, every SAS mode and the fly-by-wire arm. The kit's
 * `ToggleButton` sets `aria-pressed` from `active`; the local one set no
 * ARIA at all, so eleven two-state controls announced themselves to a screen
 * reader as plain buttons with no on/off state. Nothing flagged it, because
 * from inside the file the name resolved perfectly.
 *
 * That is the whole danger: a shadowing copy reads as correct at the call
 * site. `<ToggleButton active={sasOn}>` looks like the kit component whether
 * or not it is one, and the difference only shows up in a screen reader or a
 * theme change.
 *
 * The rule is not "never write a local styled component". It is "do not give
 * one a name the kit already owns". If the local version is genuinely
 * different, name it for what it is (`ModeBadge`, `StepBtn`, `TinyValue` all
 * pass). If it is not different, import the kit's.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const UI_KIT = join(REPO, "packages/ui-kit/src");

/** Where widgets live. ui-kit itself is excluded: it declares these names. */
const SCANNED = [
  "packages/components/src",
  "packages/app/src",
  "packages/data/src",
  "packages/serial/src",
  "packages/ui/src",
  "mod",
];

/** `const Foo = styled.tag` / `styled(Other)`, the local-component form. */
const LOCAL_STYLED_RE =
  /^(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*styled[.(]/gm;

/** `function Foo(` / `const Foo = (props) =>` at module scope. */
const LOCAL_COMPONENT_RE =
  /^(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function kitExports(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(UI_KIT)) {
    const text = readFileSync(file, "utf8");
    for (const [, name] of text.matchAll(
      /^export\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9_]*)/gm,
    )) {
      names.add(name);
    }
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part
          .replace(/^\s*type\s+/, "")
          .split(" as ")
          .pop()
          ?.trim();
        if (name && /^[A-Z]/.test(name)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * What already shadows a kit name, as `Name@repo-relative-path`.
 *
 * A DECLINING baseline, the same shape as the token ratchets: a new entry
 * fails the build, a removed one is a cleanup and passes. It is a record of
 * a backlog, not an endorsement.
 *
 * 89 entries, and the distribution is the interesting part. Two thirds are
 * `Row` (23), `Section` (16) and `SectionTitle` (10): names generic enough
 * that a widget defining its own was never really reaching for the kit's.
 * That is a question about whether ui-kit should own bare `Row`/`Value`/
 * `Section` at all, not 49 renames waiting to happen.
 *
 * The dangerous ones are the specific names, where a reader genuinely would
 * assume the kit's component: `Panel` (4), `Dial` (2), `ActionButton` (2),
 * `ConfigForm` (2), `PrimaryButton`, `EmptyState`, `StatusPill`. Those are
 * worth burning down first.
 *
 * `ToggleButton` in the Scansat Uplink is a third kind: a bare disclosure
 * button that happens to share the name, which is a rename rather than a
 * substitution. Navball's was the fourth and worst kind, a real substitute
 * with none of the ARIA, and it is already gone.
 */
const BASELINE = new Set<string>([
  "ActionButton@packages/components/src/ContractManager/index.tsx",
  "ActionButton@packages/components/src/ManeuverPlanner/NodeRow.tsx",
  "Box@packages/ui/src/DataKeyMultiPicker.tsx",
  "ConfigForm@packages/app/src/settings/SitrepConnection.tsx",
  "ConfigForm@packages/components/src/DataSourceStatus/index.tsx",
  "Dial@packages/components/src/Navball/AttitudeIndicator.tsx",
  "Dial@packages/components/src/TransferWindow/index.tsx",
  "EmptyState@packages/data/src/FlightsManager/index.tsx",
  "Field@packages/app/src/components/MissionBanner.tsx",
  "Field@packages/components/src/LandingStatus/index.tsx",
  "Field@packages/components/src/ManeuverPlanner/TriggerEditor.tsx",
  "Field@packages/data/src/FlightsManager/ChaptersEditor.tsx",
  "FieldLabel@packages/app/src/components/MissionBanner.tsx",
  "FieldLabel@packages/components/src/ManeuverPlanner/TriggerEditor.tsx",
  "FieldLabel@packages/components/src/SpaceWeather/index.tsx",
  "Grid@packages/app/src/goNoGo/GoNoGoComponent.tsx",
  "Grid@packages/components/src/CommSignal/index.tsx",
  "Grid@packages/components/src/CurrentOrbit/index.tsx",
  "Panel@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Panel@packages/app/src/components/ComponentOverlay.tsx",
  "Panel@packages/app/src/pushToMain/PushedDashboardOverlay.tsx",
  "Panel@packages/components/src/ShipMap/index.tsx",
  "PrimaryButton@packages/components/src/ManeuverPlanner/NodeRow.tsx",
  "Readout@packages/components/src/CommSignal/index.tsx",
  "Readout@packages/components/src/Navball/AttitudeIndicator.tsx",
  "Readout@packages/components/src/RoboticsConsole/index.tsx",
  "Readout@packages/components/src/SemiMajorAxis/index.tsx",
  "Row@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Row@packages/app/src/components/StationConnectionFab.tsx",
  "Row@packages/app/src/components/StationLinkFab.tsx",
  "Row@packages/app/src/settings/SettingsModal.tsx",
  "Row@packages/components/src/FleetRoster/index.tsx",
  "Row@packages/components/src/LifeSupportSystems/GreenhouseSection.tsx",
  "Row@packages/components/src/PerfBudgets/index.tsx",
  "Row@packages/components/src/PowerSystems/index.tsx",
  "Row@packages/components/src/StaffRoster/index.tsx",
  "Row@packages/components/src/StationConnectView/index.tsx",
  "Row@packages/components/src/TargetPicker/index.tsx",
  "Row@packages/components/src/ThermalStatus/index.tsx",
  "Row@packages/data/src/FlightsManager/ChaptersEditor.tsx",
  "Row@packages/serial/src/InputMappingTab.tsx",
  "Row@packages/serial/src/SerialDevicesMenu/index.tsx",
  "Row@packages/ui/src/DataKeyMultiPicker.tsx",
  "RowName@packages/components/src/PowerSystems/index.tsx",
  "RowName@packages/components/src/TargetPicker/index.tsx",
  "RowName@packages/serial/src/SerialDevicesMenu/index.tsx",
  "Section@packages/app/src/backup/BackupManager.tsx",
  "Section@packages/app/src/components/StationConnectionFab.tsx",
  "Section@packages/app/src/logs/LogsManager.tsx",
  "Section@packages/app/src/missionProfiles/MissionProfilesModal.tsx",
  "Section@packages/app/src/settings/SettingsModal.tsx",
  "Section@packages/components/src/LifeSupportSystems/index.tsx",
  "Section@packages/components/src/ManeuverPlanner/index.tsx",
  "Section@packages/components/src/PowerSystems/index.tsx",
  "Section@packages/components/src/ScienceBench/index.tsx",
  "Section@packages/components/src/SpaceWeather/index.tsx",
  "Section@packages/components/src/Strategies/index.tsx",
  "Section@packages/components/src/TargetPicker/index.tsx",
  "Section@packages/data/src/replaySession/ReplaySessionBanner.tsx",
  "Section@packages/serial/src/InputTester/index.tsx",
  "Section@packages/serial/src/VirtualDevice/index.tsx",
  "Stack@packages/ui/src/BannerStack.tsx",
  "StatusPill@packages/serial/src/InputTester/index.tsx",
  "ToggleButton@mod/GonogoScansatUplink/client/src/ScienceAugment/index.tsx",
  "Value@mod/GonogoScansatUplink/client/src/CoveragePanel/index.tsx",
  "Value@packages/components/src/CurrentOrbit/index.tsx",
  "Value@packages/components/src/ManeuverPlanner/ManeuverPreview.tsx",
  "Value@packages/serial/src/VirtualDevice/AnalogPad.tsx",
]);

describe("no local component shadows a ui-kit export", () => {
  it("finds no shadowing declaration", () => {
    const kit = kitExports();
    const offenders: string[] = [];

    for (const root of SCANNED) {
      for (const file of sourceFiles(join(REPO, root))) {
        const text = readFileSync(file, "utf8");
        // A file that IMPORTS the name from the kit and also declares it
        // would not compile, so only look at files that do not import it.
        for (const re of [LOCAL_STYLED_RE, LOCAL_COMPONENT_RE]) {
          re.lastIndex = 0;
          for (const [, name] of text.matchAll(re)) {
            if (!kit.has(name)) continue;
            const entry = `${name}@${relative(REPO, file)}`;
            if (BASELINE.has(entry)) continue;
            offenders.push(entry);
          }
        }
      }
    }

    const fresh = [...new Set(offenders)].sort();
    expect(
      fresh,
      `These declare a local component under a name @ksp-gonogo/ui-kit already
publishes, so the call site reads as the kit's component and is not:

${fresh.map((o) => `  ${o}`).join("\n")}

Either import the kit's version, or rename the local one for what it actually
is. Navball's local ToggleButton is why this guard exists: it looked right at
every call site and set aria-pressed on none of eleven controls.

If you genuinely need a differently-named local component, rename it. Adding
to BASELINE is for recording what was already there, not for new work.`,
    ).toEqual([]);
  });
});
