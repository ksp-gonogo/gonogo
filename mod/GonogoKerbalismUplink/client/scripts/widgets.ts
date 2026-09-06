/**
 * Per-widget render configs for this package's widgets, the same
 * `WidgetRenderConfig`/`SizeMode` shape (and `getWidget` lookup contract)
 * `@ksp-gonogo/components`'s `scripts/widgets.ts` uses, carried over verbatim
 * for the entries that moved here (`space-weather`, `ship-systems`) so both the
 * vitest DOM snapshot tests (`snapshots.test.tsx` in a widget's folder) and a
 * future playwright PNG probe driver can share one config. Mirrors
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
  /**
   * Synthetic clicks the PNG harness dispatches after mount + emit + settle,
   * in order, against the live DOM. Captures a state the at-rest probe never
   * reaches, such as an accordion the operator has to open.
   */
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
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
  {
    /*
     * ShipSystems: the Kerbalism vessel-wide resource ledger. Carried over
     * from `@ksp-gonogo/components`'s widgets.ts unchanged, fixtures and all,
     * so a render keeps the name it had. The committed baselines under
     * `packages/components/visual-baselines/<engine>/kerbalism-ship-systems`
     * stay where they are and go unvisited until a driver runs here, the same
     * state space-weather's have been in since it moved.
     *
     * They live in a `probe/` SUBFOLDER of the widget's own `__fixtures__/`,
     * apart from the `_scene` fixtures beside them: the `gonogo-uplink render`
     * walker only takes files whose directory is itself named `__fixtures__`,
     * and it rejects a fixture carrying no `_scene`. These three drive the
     * playwright PNG harness rather than a doc page, so the subfolder keeps
     * them out of that walk while leaving them beside the widget they belong
     * to. Another Uplink's terminal widget uses the same subfolder for the
     * same reason.
     */
    widgetId: "ship-systems",
    fixturesPath: "ShipSystems/__fixtures__/probe",
    outPath: "renders/kerbalism-ship-systems",
    modes: [
      // minSize 4×5: tightest placement the widget allows.
      { name: "min-4x5", w: 4, h: 5 },
      // defaultSize 9×15: the common operator view.
      { name: "default-9x15", w: 9, h: 15 },
      // Generous size: every section (root cause, ledger, wear, habitat,
      // processes, greenhouse augment) reads with room to spare.
      { name: "wide-12x18", w: 12, h: 18 },
      // Healthy-vessel review shot: nominal fixture only, no shortage banner,
      // panelAside status chip reads "Nominal".
      { name: "nominal-9x15", w: 9, h: 15, forFixtures: ["nominal"] },
      // Root-cause banner review shot: shortage fixture only, generous height
      // so the banner and every section below it is visible uncropped.
      {
        name: "root-cause-9x18",
        w: 9,
        h: 18,
        forFixtures: ["resource-shortage"],
      },
      /*
       * Ledger accordion expanded: click the first supply row's Disclosure
       * trigger (Electric Charge, the root cause, sorted first) to reveal its
       * buildLedger terms. aria-label is the stable selector: Disclosure's
       * trigger is a plain <button> with no other hook, and this fixture's
       * profile always names Electric Charge's displayName the same way.
       */
      {
        name: "ledger-expanded-12x18",
        w: 12,
        h: 18,
        forFixtures: ["resource-shortage"],
        clicks: [
          {
            selector:
              'button[aria-label="Show rate breakdown for Electric Charge"]',
            awaitMs: 100,
          },
        ],
      },
      /*
       * Same accordion, at the default and minimum widths: the shape that
       * caught the ledger overflowing the panel at anything narrower than
       * wide-12x18 (see LedgerBody's own doc comment).
       */
      {
        name: "ledger-expanded-9x15",
        w: 9,
        h: 15,
        forFixtures: ["resource-shortage"],
        clicks: [
          {
            selector:
              'button[aria-label="Show rate breakdown for Electric Charge"]',
            awaitMs: 100,
          },
        ],
      },
      {
        name: "ledger-expanded-4x8",
        w: 4,
        h: 8,
        forFixtures: ["resource-shortage"],
        clicks: [
          {
            selector:
              'button[aria-label="Show rate breakdown for Electric Charge"]',
            awaitMs: 100,
          },
        ],
      },
      /*
       * Ledger DESIGN review shot: resource-shortage's Electric Charge only
       * has ONE ledger term (Water Recycler), which is not enough to judge a
       * bar that is meant to diverge either side of zero. ledger-showcase's
       * Electric Charge has five terms of mixed sign and varied magnitude
       * (a dominant +0.45/s producer down to a -0.003/s trickle), at both
       * the default and a generous width, so the diverging red/green
       * DivergingBar treatment is legible across several rows at once.
       */
      {
        name: "ledger-showcase-9x15",
        w: 9,
        h: 15,
        forFixtures: ["ledger-showcase"],
        clicks: [
          {
            selector:
              'button[aria-label="Show rate breakdown for Electric Charge"]',
            awaitMs: 100,
          },
        ],
      },
      {
        name: "ledger-showcase-12x18",
        w: 12,
        h: 18,
        forFixtures: ["ledger-showcase"],
        clicks: [
          {
            selector:
              'button[aria-label="Show rate breakdown for Electric Charge"]',
            awaitMs: 100,
          },
        ],
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
