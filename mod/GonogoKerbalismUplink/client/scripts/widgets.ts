/**
 * Per-widget render configs for this package's widgets, the same
 * `WidgetRenderConfig`/`SizeMode` shape (and `getWidget` lookup contract)
 * `@ksp-gonogo/components`'s `scripts/widgets.ts` uses, carried over verbatim
 * for the entry that moved here (`space-weather`) so both the vitest DOM
 * snapshot tests (`snapshots.test.tsx` in the widget's folder) and a future
 * playwright PNG probe driver can share one config. Mirrors
 * `GonogoBreakingGroundUplink/client/scripts/widgets.ts`, which carries the
 * same three widgets' worth of config for the same reason.
 *
 * The playwright + esbuild rendering HARNESS itself
 * (`@ksp-gonogo/components`'s `scripts/widgetRenderHarness.ts`) is NOT ported
 * here: this file only carries the lightweight config types + lookup this
 * package's own DOM-snapshot tests need.
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

/**
 * The same three auto-appended size modes `@ksp-gonogo/components`'s widgets.ts
 * adds to every entry (mobile/portrait/landscape), kept identical so the moved
 * `__snapshots__/*.snap` keeps its keys.
 */
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
    // SpaceWeather: the Kerbalism radiation/storm/belt board. Fixtures are the
    // SpaceWeatherData showcase states (nominal from a real Deck capture;
    // storm/inner-belt synthesised to real config magnitudes). See
    // local_docs/spaceweather-widget-SPEC.md + local_docs/kerbalism-fixtures/.
    widgetId: "space-weather",
    fixturesPath: "SpaceWeather/__fixtures__",
    outPath: "renders/space-weather-widget",
    modes: [
      // Registered default.
      { name: "default-8x11", w: 8, h: 11 },
      // Showcase: the rich-graphics board reads best with room.
      { name: "showcase-11x11", w: 11, h: 11 },
      // Compact: sheds the flux chart + env tags, essentials only.
      { name: "compact-5x6", w: 5, h: 6 },
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
