/**
 * Per-widget render configs for this package's widgets, the same
 * `WidgetRenderConfig`/`SizeMode` shape (and `getWidget` lookup contract)
 * `@ksp-gonogo/components`'s `scripts/widgets.ts` uses, carried over verbatim
 * for the entry that moved here (`kos-terminal`) so this package's own DOM
 * snapshot tests read the sizes from one place. The same file two other Uplink
 * clients already carry, for the same reason and in the same shape.
 *
 * The playwright + esbuild rendering HARNESS itself
 * (`@ksp-gonogo/components`'s `scripts/widgetRenderHarness.ts`) is NOT ported
 * here: the pictures of this widget come from `gonogo-uplink render` driving
 * the `_scene` fixtures beside `__fixtures__/probe/`, and this file only
 * carries the lightweight config types + lookup the DOM-snapshot test needs.
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
  /** Grid-size variants to render every fixture at. */
  modes: SizeMode[];
}

/**
 * The same three auto-appended size modes `@ksp-gonogo/components`'s widgets.ts
 * adds to every entry (mobile/portrait/landscape), kept identical so a snapshot
 * key means the same shape in both packages.
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
    /*
     * kOS Terminal. A STREAM-DRIVEN widget: it reads `kos.processors` /
     * `kos.terminal.<coreId>` straight off a mounted TelemetryProvider via
     * `useStream`/`useStreamEvent`, so its fixtures carry a top-level
     * `_stream` block instead of plain data keys.
     *
     * These fixtures live in a `probe/` SUBFOLDER of the widget's
     * `__fixtures__/`, apart from the `_scene` fixtures beside them: the
     * `gonogo-uplink render` walker only takes files whose directory is
     * itself named `__fixtures__`, and it rejects a fixture carrying no
     * `_scene`. The subfolder is what keeps these two out of that walk while
     * leaving them beside the widget they belong to.
     */
    widgetId: "kos-terminal",
    fixturesPath: "KosTerminal/__fixtures__/probe",
    modes: [
      // minSize 8x6: tightest placement the widget allows.
      { name: "min-8x6", w: 8, h: 6 },
      // defaultSize 18x15: the common operator view.
      { name: "default-18x15", w: 18, h: 15 },
      // wide: generous horizontal room; the terminal itself stays a fixed
      // 80x24 grid (KOS_TERM_COLS/ROWS) regardless of container size.
      { name: "wide-24x15", w: 24, h: 15 },
      // Char-mode + comms.delay + no-path repro (`char-mode-badges` fixture
      // only): exercises the DelayBadge/NoPathBadge chrome the happy-path
      // `basic-session` fixture never triggers (no comms.* emits). Two sizes
      // catch the "badge renders outside the widget box" bug at both the
      // tightest placement and the common operator view.
      {
        name: "char-mode-8x6",
        w: 8,
        h: 6,
        config: { lineMode: false },
        forFixtures: ["char-mode-badges"],
      },
      {
        name: "char-mode-18x15",
        w: 18,
        h: 15,
        config: { lineMode: false },
        forFixtures: ["char-mode-badges"],
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
