/**
 * Per-widget render configs for this package's three Breaking Ground
 * widgets, the same `WidgetRenderConfig`/`SizeMode` shape (and `getWidget`
 * lookup contract) `@ksp-gonogo/components`'s `scripts/widgets.ts` uses,
 * carried over verbatim for the three entries that moved here
 * (`robotics-console`, `rotor-tachometer`, `deployed-science`) so both the
 * vitest DOM-snapshot tests (`snapshots.test.tsx` in each widget folder) and
 * a future playwright PNG probe driver can share one config, mirroring the
 * components package's own pattern.
 *
 * The playwright + esbuild rendering HARNESS itself
 * (`@ksp-gonogo/components`'s `scripts/widgetRenderHarness.ts`) is NOT
 * ported here yet: this file only carries the lightweight config types +
 * lookup this package's own DOM-snapshot tests need. Porting the full
 * Playwright driver / `visual-gate` CI wiring for this package is an open
 * follow-up, same status `GonogoScansatUplink/client/scripts/probe/
 * probe-entry.tsx`'s own doc comment already flags for that package.
 */

/** Grid-size variant to render a widget at. Mirrors the components package's `SizeMode`. */
export interface SizeMode {
  /** Slug used in the output filename / snapshot key. */
  name: string;
  w: number;
  h: number;
  /** Per-mode config overlay merged onto the widget's defaultConfig. */
  config?: Record<string, unknown>;
  /** Restrict the mode to a subset of fixtures. Omit to run for every fixture. */
  forFixtures?: readonly string[];
}

export interface WidgetRenderConfig {
  /** Registered widget id (matches `registerComponent({ id: ... })`). */
  widgetId: string;
  /** CLI/lookup key; defaults to widgetId. */
  label?: string;
  /** Fixtures directory path relative to this package's `src/`. */
  fixturesPath: string;
  /** Output directory path for a future PNG probe driver. */
  outPath: string;
  /** Grid-size variants to render every fixture at. */
  modes: SizeMode[];
}

// Same three auto-appended size modes `@ksp-gonogo/components`'s widgets.ts
// adds to every entry (mobile/portrait/landscape), kept identical so the
// moved `__snapshots__/*.snap` files (carried over unchanged with the
// widgets) keep matching without a snapshot regeneration.
const AUTO_MODES: readonly SizeMode[] = [
  { name: "mobile-9x8", w: 9, h: 8 },
  { name: "portrait-5x18", w: 5, h: 18 },
  { name: "landscape-18x5", w: 18, h: 5 },
];

function autoModePrefix(name: string): string {
  return name.split("-")[0];
}

function withAutoModes(config: WidgetRenderConfig): WidgetRenderConfig {
  const existingPrefixes = new Set(
    config.modes.map((m) => autoModePrefix(m.name)),
  );
  const toAppend = AUTO_MODES.filter(
    (m) => !existingPrefixes.has(autoModePrefix(m.name)),
  );
  if (toAppend.length === 0) return config;
  return { ...config, modes: [...config.modes, ...toAppend] };
}

const WIDGETS: WidgetRenderConfig[] = [
  {
    widgetId: "deployed-science",
    fixturesPath: "DeployedScience/__fixtures__",
    outPath: "renders/deployed-science-widget",
    modes: [
      // Minimum size: base header + first experiment, rest scrolls.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size: a base card with its experiments.
      { name: "default-5x9", w: 5, h: 9 },
      // Tall: multiple bases stacked.
      { name: "tall-5x16", w: 5, h: 16 },
      // DLC-absent empty state.
      { name: "unavailable-5x9", w: 5, h: 9, forFixtures: ["unavailable"] },
    ],
  },
  {
    widgetId: "robotics-console",
    fixturesPath: "RoboticsConsole/__fixtures__",
    outPath: "renders/robotics-console-widget",
    modes: [
      // Minimum size: readout + Target stepper only; the motor/lock toggles
      // and the joint list both hide below h=6 so neither clips the stepper
      // (see the showToggles/showServoList gates in RoboticsConsole/index.tsx).
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size: readout + controls + joint list.
      { name: "default-5x8", w: 5, h: 8 },
      // Wide: controls and list get horizontal room.
      { name: "wide-9x6", w: 9, h: 6 },
      // DLC-absent empty state.
      { name: "unavailable-5x8", w: 5, h: 8, forFixtures: ["unavailable"] },
    ],
  },
  {
    widgetId: "rotor-tachometer",
    fixturesPath: "RotorTachometer/__fixtures__",
    outPath: "renders/rotor-tachometer-widget",
    modes: [
      // Minimum registered size (h<6): gauge suppressed, controls + list.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size: dial + controls + 2-rotor list.
      { name: "default-6x10", w: 6, h: 10 },
      // Wide: controls and list get horizontal room.
      { name: "wide-9x7", w: 9, h: 7 },
      // DLC-absent empty state.
      {
        name: "unavailable-5x9",
        w: 5,
        h: 9,
        forFixtures: ["unavailable"],
      },
    ],
  },
];

export function listWidgets(): readonly WidgetRenderConfig[] {
  return WIDGETS.map(withAutoModes);
}

export function getWidget(id: string): WidgetRenderConfig | undefined {
  const found = WIDGETS.find((w) => (w.label ?? w.widgetId) === id);
  return found ? withAutoModes(found) : undefined;
}
