/**
 * Per-widget render configs consumed by the shared `widgetRenderHarness`.
 * Each entry maps a registered widget id to its fixtures directory, output
 * directory, and the grid-size modes the harness should screenshot.
 *
 * Adding a new widget = drop a new entry here. No new script file, no
 * package.json change. The `render-widget` CLI looks the entry up by id.
 *
 * Notes on modes:
 * - `name` becomes the filename slug (`<fixture>--<mode>.png`).
 * - `w` × `h` are grid units; the harness converts to pixels via the
 *   dashboard's COL_WIDTH / ROW_HEIGHT / GRID_MARGIN constants.
 * - `config` overrides the widget's defaultConfig for that mode only.
 */
import type {
  ScreenRenderConfig,
  SizeMode,
  WidgetRenderConfig,
} from "./widgetRenderHarness";

const WIDGETS: WidgetRenderConfig[] = [
  {
    // The rebooted Landing widget on a SYNTHETIC Mun descent (model-generated,
    // see scripts/synthesize-landing-descent.ts). Three _stream frames sweep
    // the UX: high (DIVERT site far downrange), ignition (burn band lit +
    // commit window, MARGINAL), final (SAFE, gear down, near touchdown). Large
    // size so the Touchdown Reticle + Descent Scope + Commit Layer all render.
    // NOTE: the four `landing-status/*` configs are all the SAME widget
    // (`landing-status`): four RENDER SCENARIOS of it, not four widgets.
    widgetId: "landing-status",
    label: "landing-status/descent-gif",
    fixturesPath: "LandingStatus/__render__",
    outPath: "renders/landing-widget",
    // Full-content capture at the real 12-col tile width, the whole tile,
    // uncropped, so the composed instrument can actually be reviewed.
    modes: [{ name: "full-w12", w: 12, h: 16 }],
  },
  {
    // CURRENCY showcase: whether an operator can tell, at a glance, which
    // numbers the board is asserting and which it is merely describing.
    //
    // The rule it renders is "describe from what we have, refuse to instruct
    // from what we do not": altitude, velocity and the delta-v margin are
    // descriptions and survive a stale input with a caption, while the
    // suicide-burn instant is an instruction and is withheld outright. Losing
    // contact mid-descent is the expected case rather than an edge, so the
    // interesting render is the stale one, not the live one.
    //
    // Both a wide and a narrow mode, because the caption competing with the
    // hero for room is a small-breakpoint problem.
    widgetId: "landing-status",
    label: "landing-status/currency",
    fixturesPath: "LandingStatus/__render_currency__",
    outPath: "renders/landing-status/currency",
    fullContent: true,
    modes: [
      { name: "full-w12", w: 12, h: 16 },
      { name: "compact-4x5", w: 4, h: 5 },
    ],
  },
  {
    // Terrain-type showcase: the Touchdown Reticle relief across distinct
    // synthesized terrains (flat / slope / steep / crater / ridge / boulder),
    // one near-touchdown frame each so the hillshade + SAFE/MARGINAL/DIVERT
    // verdict tracks the terrain. Same widget, a dedicated fixtures dir.
    widgetId: "landing-status",
    label: "landing-status/terrains",
    fixturesPath: "LandingStatus/__render_terrains__",
    outPath: "renders/landing-status/terrains",
    fullContent: true,
    modes: [{ name: "full-w12", w: 12, h: 16 }],
  },
  {
    // Atmospheric descent showcase: the mod's terminal-velocity model (from
    // measured drag) rendered across every regime (accelerating / at-terminal /
    // decelerating / chute-deployed) plus the honest ESTIMATE fallback when the
    // mod ships no terminal velocity. Same widget, a dedicated fixtures dir.
    widgetId: "landing-status",
    label: "landing-status/atmospheric",
    fixturesPath: "LandingStatus/__render_atmospheric__",
    outPath: "renders/landing-status/atmospheric",
    fullContent: true,
    modes: [
      { name: "tall-8x12", w: 8, h: 12 },
      { name: "standard-6x9", w: 6, h: 9 },
    ],
  },
  {
    // MapView paints to <canvas> (equirectangular body texture + fog
    // overlay + vessel trail). The playwright harness captures the
    // canvas pixels directly: no parallel SVG renderer needed for
    // visual coverage, just the standard fixture/mode pattern. The DOM
    // snapshot test snaps the chrome around the canvas (which is the
    // useful structural-regression layer); canvas pixels live only in
    // the PNG harness, which we don't pixel-diff.
    widgetId: "map-view",
    fixturesPath: "MapView/__fixtures__",
    outPath: "renders/map-view-widget",
    modes: [
      // Minimum size: chrome thin, body fill dominates.
      { name: "tiny-3x4", w: 3, h: 4 },
      // Square small: confirms aspect-fit doesn't squish the map.
      { name: "square-6x6", w: 6, h: 6 },
      // Default registered size.
      { name: "default-12x18", w: 12, h: 18 },
      // Wide landscape: equirectangular projection reads best here.
      { name: "wide-18x10", w: 18, h: 10 },
      // Body picker pinned to a NON-active body (Mun). Vessel marker +
      // trail + prediction all vanish; the label reads "Mun (pinned)".
      // Proves the picker decouples from v.body.
      {
        name: "pin-mun-14x12",
        w: 14,
        h: 12,
        config: { bodyOverride: "Mun" },
      },
    ],
  },
  {
    widgetId: "navball",
    fixturesPath: "Navball/__fixtures__",
    outPath: "renders/navball-widget",
    modes: [
      { name: "tiny-3x4", w: 3, h: 4 },
      { name: "medium-4x7", w: 4, h: 7 },
      { name: "wide-5x8", w: 5, h: 8 },
      // 7×12 is below the control-surface threshold (rows≥18, cols≥7) so
      // controlMode degrades to dial-only: same display as a wide-mode
      // widget. Useful for catching regressions to the degrade path.
      { name: "degraded-7x12", w: 7, h: 12, config: { controlMode: true } },
      // Minimum sensible control-mode size; everything above lights up
      // the SAS / throttle / FBW surface.
      { name: "full-7x20", w: 7, h: 20, config: { controlMode: true } },
      // Generous control-mode size that lets every group breathe.
      { name: "xl-9x24", w: 9, h: 24, config: { controlMode: true } },
      // Control-delay stream: control mode + a fixture carrying a non-zero
      // comms.delay so ControlDelayStream renders (it self-hides at ~0 delay).
      // Anchors the sparkline's chrome (dividers, ramp, fills) in the visual gate.
      {
        name: "control-delay-7x20",
        w: 7,
        h: 20,
        config: { controlMode: true },
        forFixtures: ["control-delay"],
      },
    ],
  },
  {
    widgetId: "orbit-view",
    fixturesPath: "OrbitView/__fixtures__",
    outPath: "renders/orbit-view-widget",
    modes: [
      // Pill fallback: both thresholds unmet; only status pill rendered.
      { name: "pill-3x3", w: 3, h: 3 },
      // Landscape-relaxed diagram: cols≥8 && rows≥3 branch.
      { name: "landscape-10x3", w: 10, h: 3 },
      // Minimum square diagram: just above the 5×5 threshold.
      { name: "square-5x5", w: 5, h: 5 },
      // Default registered size for the widget.
      { name: "default-9x18", w: 9, h: 18 },
      // Generous size: body, orbit, and labels have plenty of room.
      { name: "large-14x22", w: 14, h: 22 },
    ],
  },
  {
    widgetId: "current-orbit",
    fixturesPath: "CurrentOrbit/__fixtures__",
    outPath: "renders/current-orbit-widget",
    modes: [
      // Minimum size (3×4): Ap + Pe only, no subtitle, no diagram.
      { name: "tiny-3x4", w: 3, h: 4 },
      // 4×6: adds subtitle, inclination, t-Ap/t-Pe. Diagram still hidden.
      { name: "compact-4x6", w: 4, h: 6 },
      // 5×8: all rows + diagram slot (rows=8, cols=5, exactly on threshold).
      { name: "medium-5x8", w: 5, h: 8 },
      // Default size: every row + generous diagram.
      { name: "default-9x18", w: 9, h: 18 },
      // Landscape: wide and shallow: ResizeObserver flips flex-direction.
      { name: "landscape-12x6", w: 12, h: 6 },
    ],
  },
  {
    widgetId: "twr",
    fixturesPath: "Twr/__fixtures__",
    outPath: "renders/twr-widget",
    modes: [
      // Tiny variant: numeric readout only.
      { name: "tiny-2x2", w: 2, h: 2 },
      // Small: gauge only, no sparkline.
      { name: "small-3x3", w: 3, h: 3 },
      // Default: gauge + sparkline + subtitle.
      { name: "default-4x5", w: 4, h: 5 },
      // Wider room for the gauge to fill space.
      { name: "wide-6x8", w: 6, h: 8 },
    ],
  },
  {
    widgetId: "kepler-period",
    fixturesPath: "KeplerPeriod/__fixtures__",
    outPath: "renders/kepler-period-widget",
    modes: [
      // Documented minimum: confirms the graph doesn't overflow.
      { name: "min-5x4", w: 5, h: 4 },
      // Default size: the most common operator view.
      { name: "default-10x8", w: 10, h: 8 },
      // Tall narrow: useful for a sidebar column.
      { name: "tall-6x12", w: 6, h: 12 },
      // Wide short: approximates a bottom-bar placement.
      { name: "wide-14x6", w: 14, h: 6 },
      // Large: confirms the Kepler curve stays proportional.
      { name: "xl-14x12", w: 14, h: 12 },
    ],
  },
  {
    widgetId: "semi-major-axis",
    fixturesPath: "SemiMajorAxis/__fixtures__",
    outPath: "renders/semi-major-axis-widget",
    modes: [
      // No subtitle, no sparkline: value only.
      { name: "tiny-3x3", w: 3, h: 3 },
      // Subtitle appears, sparkline still suppressed (cols<3).
      { name: "subtitle-2x4", w: 2, h: 4 },
      // Default: subtitle + sparkline both visible.
      { name: "default-4x4", w: 4, h: 4 },
      // Extra vertical room: sparkline has more breathing space.
      { name: "medium-5x6", w: 5, h: 6 },
      // Generous width: sparkline fully expanded.
      { name: "wide-8x8", w: 8, h: 8 },
    ],
  },
  {
    widgetId: "atmosphere-profile",
    fixturesPath: "AtmosphereProfile/__fixtures__",
    outPath: "renders/atmosphere-profile-widget",
    modes: [
      // Minimum widget size: tests that the chart area doesn't collapse.
      { name: "min-5x4", w: 5, h: 4 },
      // Comfortable single-column size.
      { name: "medium-6x8", w: 6, h: 8 },
      // Default dashboard size.
      { name: "default-8x8", w: 8, h: 8 },
      // Taller layout: good for reading the log Y axis clearly.
      { name: "tall-6x12", w: 6, h: 12 },
      // Wide layout with custom altitudeCeiling override.
      {
        name: "wide-ceiling-12x8",
        w: 12,
        h: 8,
        config: { altitudeCeiling: 200_000 },
      },
    ],
  },
  {
    widgetId: "escape-profile",
    fixturesPath: "EscapeProfile/__fixtures__",
    outPath: "renders/escape-profile-widget",
    modes: [
      { name: "tiny-4x4", w: 4, h: 4 },
      { name: "small-5x6", w: 5, h: 6 },
      { name: "default-10x8", w: 10, h: 8 },
      { name: "wide-14x10", w: 14, h: 10 },
    ],
  },
  {
    widgetId: "targeting",
    fixturesPath: "Targeting/__fixtures__",
    outPath: "renders/targeting-widget",
    modes: [
      {
        name: "tiny-3x4",
        w: 3,
        h: 4,
        config: { autoSwitch: true, hudMode: "hud" },
      },
      {
        name: "compact-4x5",
        w: 4,
        h: 5,
        config: { autoSwitch: true, hudMode: "hud" },
      },
      {
        name: "default-6x9",
        w: 6,
        h: 9,
        config: { autoSwitch: true, hudMode: "hud" },
      },
      {
        name: "wide-8x12",
        w: 8,
        h: 12,
        config: { autoSwitch: true, hudMode: "hud" },
      },
    ],
  },
  {
    // The distinct-state scenario matrix (final-approach / suicide-burn /
    // landed / atmospheric / no-landing-vector). Full-content so tall states
    // aren't cropped: the modes vary the WIDTH + the height-gated rows the
    // widget shows, and fullContent captures the whole result uncropped.
    widgetId: "landing-status",
    label: "landing-status/scenarios",
    fixturesPath: "LandingStatus/__fixtures__",
    outPath: "renders/landing-status/scenarios",
    fullContent: true,
    modes: [
      // Minimum size: suicide-burn row only.
      { name: "compact-4x5", w: 4, h: 5 },
      // Subtitle appears + impact/speed rows begin.
      { name: "medium-6x7", w: 6, h: 7 },
      // Altitude + descent rows added (rows>=8).
      { name: "standard-6x9", w: 6, h: 9 },
      // Default size: full metric grid + best-impact-inline.
      { name: "default-8x11", w: 8, h: 11 },
      // Tall atmospheric view: rows>=9 unlocks the ambient section.
      { name: "tall-atm-8x12", w: 8, h: 12 },
    ],
  },
  {
    widgetId: "comm-signal",
    fixturesPath: "CommSignal/__fixtures__",
    outPath: "renders/comm-signal-widget",
    modes: [
      // Minimum size: bars + headline only, no subtitle or detail grid
      // (rows<4 suppresses both). Catches overflow at tight sizes.
      { name: "min-3x3", w: 3, h: 3 },
      // Default registered size: bars, subtitle, and full detail grid.
      { name: "default-6x5", w: 6, h: 5 },
      // Tall narrow: detail grid wraps in a single column layout.
      { name: "tall-4x7", w: 4, h: 7 },
      // Wide short: subtitle visible, grid has generous horizontal room.
      { name: "wide-9x4", w: 9, h: 4 },
      // Generous size: full content, comfortable spacing.
      { name: "large-8x8", w: 8, h: 8 },
    ],
  },
  {
    widgetId: "space-center-status",
    fixturesPath: "SpaceCenterStatus/__fixtures__",
    outPath: "renders/space-center-status-widget",
    modes: [
      // Tiny mode (sizeBucket="tiny"): funds + PAD ACTIVE/CLEAR pill only.
      { name: "tiny-2x3", w: 2, h: 3 },
      // Compact: facility grid in 2-col (cols<5), no full-text tier bodies.
      { name: "compact-4x7", w: 4, h: 7 },
      // Default registered size: 3-col facility grid, subtitle with funds.
      { name: "default-6x7", w: 6, h: 7 },
      // Wide: 3-col grid has room to breathe; tier text bodies appear.
      { name: "wide-9x10", w: 9, h: 10 },
      // Tall: scroll area gets plenty of vertical room for tier descriptions.
      { name: "tall-6x14", w: 6, h: 14 },
    ],
  },
  {
    // Astronaut Complex: header (funds, next-hire cost, active/max crew cap)
    // above the Applicants | Active tabs. Applicants renders each candidate
    // through the shared crew-stat row (trait, courage, stupidity, no rank)
    // with an arm-then-confirm Hire button. Active is itself tabbed, one
    // sub-tab per distinct situation auto-derived from the hired-crew roster.
    widgetId: "astronaut-complex",
    fixturesPath: "AstronautComplex/__render__",
    outPath: "renders/astronaut-complex-widget",
    fullContent: true,
    modes: [
      // Default registered size, Applicants tab (the initial tab).
      { name: "default-6x8", w: 6, h: 8 },
      // Narrow: rows compress; confirms the Hire button doesn't clip.
      { name: "narrow-4x8", w: 4, h: 8 },
      // Tall: full pool with room to breathe.
      { name: "tall-6x12", w: 6, h: 12 },
      // Switch to the Active tab: default fixtures carry no crewRoster
      // sample, so this captures the empty state; the multi-situation
      // fixture (below) captures the populated, auto-derived sub-tabs.
      {
        name: "active-tab-6x8",
        w: 6,
        h: 8,
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, default sub-tab (Available, the first standing present),
      // derived from active-crew-multi-situation's roster. Ludrey and Nedcas
      // are the two kerbals free to fly, and Nedcas is the row whose readings
      // never arrived: rank, courage, stupidity and progress all read as a
      // dash rather than as an L0 rookie's stats. Bill is standing down and
      // Lodan is mid-course, and both sit in tabs of their own with a reason
      // and a date.
      {
        name: "active-tab-available-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Same Available sub-tab, Fire armed: proves the arm-then-confirm
      // sequence flips the row's control to the go-toned Confirm state.
      // Fire also renders on the Resting and Training tabs, because the roster
      // accepts a sacking there and firing is not flying; it never renders on
      // Assigned or on a kerbal off the books.
      {
        name: "active-tab-available-fire-armed-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-label^="Fire "]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Assigned sub-tab: a crewed-out kerbal (Jeb), unavailable
      // with the "On mission" reason badge.
      {
        name: "active-tab-assigned-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-3-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Training sub-tab: the standing KSP has no field for at all.
      // Lodan's roster status is Available throughout his course, so this tab
      // exists only because the producer derives the standing, and the row shows
      // the reason and a date the client formatted.
      {
        name: "active-tab-training-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-4-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Resting sub-tab: Bill after a flight. Available to KSP,
      // unavailable here, and STILL fireable, because the roster accepts a
      // sacking from a stand-down and firing is not flying.
      {
        name: "active-tab-resting-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-5-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Dead sub-tab: proves Dead/Missing get their own tabs rather
      // than folding into a stock-style "Lost" tab, and that the RP-1 retiree
      // is NOT in here despite carrying KSP's Dead ordinal.
      {
        name: "active-tab-dead-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-7-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Retired sub-tab: THE render this widget exists to get right.
      // Gus carries KSP's Dead ordinal because that is what RP-1 wrote into it,
      // and the standing is what puts him here instead, with a badge that is
      // not the red one Val's fatality wears.
      {
        name: "active-tab-retired-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-6-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Missing sub-tab: the max-rank kerbal (L5), whose
      // experience-toward-next-rank chip reads MAX rather than a redundant 100%.
      {
        name: "active-tab-missing-max-rank-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-controls$="standing-8-panel"]',
            awaitMs: 100,
          },
        ],
      },
      // Active tab, Available sub-tab, with Ludrey Kerman's per-row info
      // popover open: the stock role description + current-rank effects
      // (ExperienceTrait.Description/DescriptionEffects), portalled so the
      // ScrollArea around the row can't clip it.
      {
        name: "info-popover-open-6x12",
        w: 6,
        h: 12,
        forFixtures: ["active-crew-multi-situation"],
        clicks: [
          {
            selector: 'button[aria-controls$="active-panel"]',
            awaitMs: 100,
          },
          {
            selector: 'button[aria-label="Role info for Ludrey Kerman"]',
            awaitMs: 150,
          },
        ],
      },
    ],
  },
  {
    widgetId: "thermal-status",
    fixturesPath: "ThermalStatus/__fixtures__",
    outPath: "renders/thermal-status-widget",
    modes: [
      // Minimum size (3×4): pill only, no detail rows (rows<5 suppresses
      // hottest-part row). Verifies the pill + EmptyState render cleanly.
      { name: "pill-only-3x4", w: 3, h: 4 },
      // 4×5: hottest-part row unlocks (rows>=5), engine still hidden.
      { name: "hottest-only-4x5", w: 4, h: 5 },
      // 5×6: engine row added (rows>=6). Just below the cols>=6 threshold
      // for the inline alert note (only 5 cols), so alert is pill-only.
      { name: "two-rows-5x6", w: 5, h: 6 },
      // Default size: all rows when shield data present (rows>=7).
      // cols>=6 so inline alert note renders in critical fixtures.
      { name: "default-8x7", w: 8, h: 7 },
      // Larger: generous scroll area for all rows + breathing room.
      { name: "large-10x10", w: 10, h: 10 },
    ],
  },
  {
    widgetId: "contract-manager",
    fixturesPath: "ContractManager/__fixtures__",
    outPath: "renders/contract-manager-widget",
    modes: [
      // Minimum size: title only, no subtitle (h<4 branch). Catches
      // overflow on the tightest plausible placement.
      { name: "tiny-4x3", w: 4, h: 3 },
      // Compact: title + subtitle; contract cards start rendering.
      { name: "compact-4x5", w: 4, h: 5 },
      // Default registered size: subtitle + full card list + scroll.
      { name: "default-6x8", w: 6, h: 8 },
      // Wider layout: lets long contract titles + reward rows breathe.
      { name: "wide-8x10", w: 8, h: 10 },
      // Tall layout: more contracts visible without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
      // Scrolled-ghost coverage: a standard-header widget whose card list
      // overflows, scrolled to the bottom so the real title is out of view and
      // the condensing title ghost (Panel Option 5) fades in at the top edge.
      // The at-rest probe never captures this, so it is the ONLY gate on the
      // ghost's scrolled-in appearance. Scoped to the multi-contract fixture
      // that actually overflows a 6×8 tile.
      {
        name: "ghost-scrolled-6x8",
        w: 6,
        h: 8,
        scroll: 800,
        forFixtures: ["multiple-active-contracts"],
      },
    ],
  },
  {
    widgetId: "warp-control",
    fixturesPath: "WarpControl/__fixtures__",
    outPath: "renders/warp-control-widget",
    modes: [
      // Below full-ladder threshold (cols*rows=12 < 20): stepper only (cols≥3,
      // rows≥3). Mode caption suppressed (rows=3 < 4).
      { name: "minimal-4x3", w: 4, h: 3 },
      // Default registered size: full 8-button ladder (cols*rows=30≥20,
      // cols=6≥4, rows=5≥3). Mode caption visible (rows=5≥4).
      { name: "default-6x5", w: 6, h: 5 },
      // Wide short: ladder reflows to 8×1 single row; mode caption visible.
      { name: "wide-10x4", w: 10, h: 4 },
      // Tall narrow: cols=4, rows=8 → cols*rows=32≥20 → full ladder; auto-fit
      // wraps buttons; mode caption visible.
      { name: "tall-4x8", w: 4, h: 8 },
      // Large: generous room for all elements.
      { name: "large-8x7", w: 8, h: 7 },
    ],
  },
  {
    widgetId: "launch-director",
    fixturesPath: "LaunchDirector/__fixtures__",
    outPath: "renders/launch-director-widget",
    modes: [
      // Minimum registered size: subtitle visible (h>=4), compact pad list.
      { name: "min-4x6", w: 4, h: 6 },
      // Default registered size: pad list plus the open pad's craft and crew.
      { name: "default-7x10", w: 7, h: 10 },
      // Tall narrow: the whole pad list plus a long craft list under the open one.
      { name: "tall-5x14", w: 5, h: 14 },
      // Wide landscape: buttons and rows have horizontal breathing room.
      { name: "wide-10x7", w: 10, h: 7 },
      // Click-driven modes: capture the arm-then-confirm sequences
      // that are otherwise invisible to the static probe. Scoped to
      // in-flight fixtures via `forFixtures` since arm-recover /
      // arm-revert buttons only render when a recoverable vessel is
      // active. Targets `data-launch-action` attributes on
      // ArmedButton.
      {
        name: "armed-recover-7x10",
        w: 7,
        h: 10,
        clicks: [{ selector: '[data-launch-action="arm-recover"]' }],
        forFixtures: ["in-flight-ascent", "pad-occupied"],
      },
      {
        name: "armed-revert-7x10",
        w: 7,
        h: 10,
        clicks: [{ selector: '[data-launch-action="arm-revert"]' }],
        forFixtures: ["in-flight-ascent", "pad-occupied"],
      },
      // The crew grid and the launch control only render once a craft is
      // picked, so click the first craft row under the open pad to reveal
      // them. Scoped to the multi-pad pre-launch fixture.
      {
        name: "craft-picked-7x18",
        w: 7,
        h: 18,
        clicks: [{ selector: "[data-ship-row]" }],
        forFixtures: ["pre-launch-mixed"],
      },
      // A second pad opened: the runway, whose craft are the spaceplanes the
      // VAB pad above does not offer.
      {
        name: "runway-opened-7x14",
        w: 7,
        h: 14,
        clicks: [{ selector: '[data-pad-row][aria-pressed="false"]' }],
        forFixtures: ["pre-launch-mixed"],
      },
    ],
  },
  // deployed-science / robotics-console moved to
  // @ksp-gonogo/gonogo-breaking-ground-uplink/scripts/widgets.ts alongside
  // the Breaking Ground uplink extraction.
  {
    widgetId: "objectives",
    fixturesPath: "Objectives/__fixtures__",
    outPath: "renders/objectives-widget",
    modes: [
      // Minimum registered width: tight list, source tags wrap.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size: unified contract-parameter list.
      { name: "default-5x8", w: 5, h: 8 },
      // Tall: several active contracts.
      { name: "tall-5x16", w: 5, h: 16 },
    ],
  },
  // rotor-tachometer moved to
  // @ksp-gonogo/gonogo-breaking-ground-uplink/scripts/widgets.ts alongside
  // the Breaking Ground uplink extraction.
  {
    widgetId: "action-group",
    fixturesPath: "ActionGroup/__fixtures__",
    outPath: "renders/action-group-widget",
    modes: [
      // Minimum size (3×3): tiny bucket (w<5): label + the ON/OFF state pill
      // (itself the toggle button); no UnavailableNotice, no bell.
      { name: "tiny-3x3", w: 3, h: 3 },
      // 3×4: still tiny bucket (w<5) so OfficialName and bell are suppressed;
      // the state-pill toggle is present at every size.
      { name: "compact-3x4", w: 3, h: 4, config: { actionGroupId: "RCS" } },
      // 6×4: normal bucket: OfficialName visible (cols>=5), state-pill toggle
      // present. Gear group with custom label exercises the secondary line.
      {
        name: "normal-6x4",
        w: 6,
        h: 4,
        config: { actionGroupId: "Gear", label: "Landing Gear" },
      },
      // Default registered size (6×6): full UI with custom label.
      {
        name: "default-6x6",
        w: 6,
        h: 6,
        config: { actionGroupId: "AG1", label: "Chutes" },
      },
      // Wide: label + OfficialName strip have generous horizontal room.
      { name: "wide-9x6", w: 9, h: 6, config: { actionGroupId: "SAS" } },
    ],
  },
  {
    widgetId: "fuel-status",
    fixturesPath: "FuelStatus/__fixtures__",
    outPath: "renders/fuel-status-widget",
    modes: [
      // rows=3, cols=3: showTotals=false, showHeroDv=true if totalDv set.
      // No subtitle, no resources, no stages: hero ΔV branch.
      { name: "tiny-3x3", w: 3, h: 3 },
      // rows=4, cols=4: showTotals=true; showSubtitle still false (rows<5).
      // TotalsRow appears, resource list + stage stack still hidden.
      { name: "compact-4x4", w: 4, h: 4 },
      // rows=7, cols=5: showTotals + showSubtitle + showResourceList all true.
      // Stage stack still hidden (rows<10). Resource bars first appear here.
      { name: "medium-5x7", w: 5, h: 7 },
      // defaultSize (8×14): all sections live. Stage stack + resources both on.
      { name: "default-8x14", w: 8, h: 14 },
      // Wide generous size with VAC ΔV mode to exercise the deltaVMode column.
      { name: "wide-vac-10x18", w: 10, h: 18, config: { deltaVMode: "vac" } },
    ],
  },
  {
    widgetId: "power-systems",
    fixturesPath: "PowerSystems/__fixtures__",
    outPath: "renders/power-systems-widget",
    modes: [
      // Compact path: cols<6 || rows<8: shows resource name + net rate only.
      { name: "tiny-3x3", w: 3, h: 3 },
      // Compact with header visible (rows>=4 → showHeader=true, still !showFullList).
      { name: "compact-4x5", w: 4, h: 5 },
      // Exactly on the full-list threshold (cols=6, rows=8), full layout.
      { name: "threshold-6x8", w: 6, h: 8 },
      // Default registered size: totals row, all three sections visible.
      { name: "default-8x12", w: 8, h: 12 },
      // Generous size: every section breathes; STORED cell visible when present.
      { name: "wide-12x16", w: 12, h: 16 },
    ],
  },
  {
    widgetId: "resource-ops",
    fixturesPath: "ResourceOps/__fixtures__",
    outPath: "renders/resource-ops-widget",
    modes: [
      // Registered default size: the converter recipes (inputs → outputs)
      // must be fully readable here, wrapping rather than clipping.
      { name: "default-6x8", w: 6, h: 8 },
      // Generous width: recipes fit on one line, nothing wraps.
      { name: "wide-12x8", w: 12, h: 8 },
    ],
  },
  {
    widgetId: "strategies",
    fixturesPath: "Strategies/__fixtures__",
    outPath: "renders/strategies-widget",
    modes: [
      // tiny bucket (w<5 or h<4): header-only showing just the active count
      // tally; no ScrollArea, no section lists.
      { name: "tiny-3x3", w: 3, h: 3 },
      // compact normal: full panel with tight vertical room; tests ScrollArea
      // overflow when Active + Available sections both have entries.
      { name: "compact-5x7", w: 5, h: 7 },
      // default registered size: the most common operator view.
      { name: "default-5x9", w: 5, h: 9 },
      // tall: generous vertical room; long effect lists and all three sections
      // (Active / Available / Locked) can breathe without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
      // wide: exercises the horizontal layout at normal bucket; header meta
      // bar (funds / rep / sci readouts) has more room to spread.
      { name: "wide-9x12", w: 9, h: 12 },
    ],
  },
  // ── Wave 2 (2026-05-29): widgets fixtured from a live career capture
  //    (Kerbin orbit, Mk1 pod). See local_docs/.../captures/. ─────────────
  {
    widgetId: "crew-status",
    fixturesPath: "CrewStatus/__fixtures__",
    outPath: "renders/crew-status-widget",
    modes: [
      // minSize 3×3: single-crew row, tightest placement.
      { name: "tiny-3x3", w: 3, h: 3 },
      // narrowest roster width (showRoster's own w>=4 floor): exercises the
      // per-crew-row badge WRAP behaviour (a badge that doesn't fit next to
      // the name drops to its own line instead of truncating it).
      { name: "narrow-4x10", w: 4, h: 10 },
      // defaultSize 6×8: the common operator view.
      { name: "default-6x8", w: 6, h: 8 },
      // wide/tall: roomy crew list.
      { name: "wide-9x10", w: 9, h: 10 },
    ],
  },
  {
    // CrewStatus's per-kerbal survival, an ADDITIVE Kerbalism augment: the
    // widget itself (registered above) reads only the vanilla `vessel.crew`
    // roster now; the CrewSurvival augment lives entirely in the Uplink
    // (mod/GonogoKerbalismUplink/client/src/CrewSurvival) and fills the
    // generic `crew-status.meters` segment CrewStatus draws per row. Same
    // widget as above, a dedicated fixtures dir (mirrors landing-status's
    // multi-scenario convention): `label` disambiguates this render set from
    // the base-widget one since both share `widgetId: "crew-status"`.
    widgetId: "crew-status",
    label: "crew-status/kerbalism-survival",
    fixturesPath: "CrewStatus/__render_kerbalism_survival__",
    outPath: "renders/kerbalism-crew-survival",
    modes: [
      // Narrowest roster width: the badge-wrap case actually has badges to
      // wrap here (crew-critical.json's per-kerbal warnings), unlike the
      // vanilla base-widget fixtures above which never bind the slot.
      { name: "narrow-4x10", w: 4, h: 10 },
      // defaultSize 6×8: the common operator view, both fixtures.
      { name: "default-6x8", w: 6, h: 8 },
      // Wide/tall review shot: every row's survival meter + badge readable
      // without scrolling, both fixtures.
      { name: "wide-9x12", w: 9, h: 12 },
    ],
  },
  {
    widgetId: "experiments",
    fixturesPath: "Experiments/__fixtures__",
    outPath: "renders/experiments-widget",
    modes: [
      // minSize 3×4: instrument list, tight.
      { name: "min-3x4", w: 3, h: 4 },
      // defaultSize 6×7: the common view.
      { name: "default-6x7", w: 6, h: 7 },
      // wide: instrument rows + status have room.
      { name: "wide-9x10", w: 9, h: 10 },
    ],
  },
  {
    widgetId: "tech-tree",
    fixturesPath: "TechTree/__fixtures__",
    outPath: "renders/tech-tree-widget",
    modes: [
      // minSize 2×2: tightest; tally / degraded.
      { name: "tiny-3x4", w: 3, h: 4 },
      // defaultSize 6×9: the common operator view.
      { name: "default-6x9", w: 6, h: 9 },
      // tall: more of the tree visible without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
      // wide landscape: closest to an in-game tech-tree aspect.
      { name: "wide-16x10", w: 16, h: 10 },
      // large: generous room for a node-graph layout.
      { name: "xl-18x16", w: 18, h: 16 },
    ],
  },
  {
    widgetId: "system-view",
    fixturesPath: "SystemView/__fixtures__",
    outPath: "renders/system-view-widget",
    modes: [
      // minSize 3×4: smallest diagram.
      { name: "min-3x4", w: 3, h: 4 },
      // square: confirms the system diagram doesn't squish.
      { name: "square-6x6", w: 6, h: 6 },
      // defaultSize 10×12: the common operator view.
      { name: "default-10x12", w: 10, h: 12 },
      // wide landscape.
      { name: "wide-14x10", w: 14, h: 10 },
      // The selection payoff: clicks the Munar Transfer Stage's own orbit
      // ring (a relayed CommNet route, home -> Comsat Relay-1 -> Munar
      // Transfer Stage), showing the brightened orbit, the two-hop path
      // highlight coloured by that craft's own Partial control state, and
      // the swapped vessel info panel, against multi-vessel-orbits.json's
      // existing fleet and relay graph.
      {
        name: "vessel-selected",
        w: 10,
        h: 12,
        forFixtures: ["multi-vessel-orbits"],
        clicks: [
          {
            selector: '[data-entity-id="vessel-orbit:v-munar-transfer"]',
            awaitMs: 200,
          },
        ],
      },
      // The projection seam, under a frame that is not the identity: the bodies,
      // their rings and the craft's curve all turn with the bearing to Kerbol,
      // which is what "hold the parent still" always claimed and never did.
      // Scoped to the one inclined fixture, because a coplanar-circular system
      // under a rotating frame is a picture whose foreshortening is zero.
      {
        name: "parent-direction-10x12",
        w: 10,
        h: 12,
        forFixtures: ["kerbin-orbit-inclined"],
        config: {
          frame: "Kerbin",
          projection: "system-view.parent-direction.1",
        },
      },
    ],
  },
  {
    widgetId: "graph",
    fixturesPath: "Graph/__fixtures__",
    outPath: "renders/graph-widget",
    // Graph is config-driven: the per-mode `config` carries the series list +
    // render options; the fixture supplies the `_series` data those keys plot
    // against. This matrix exercises EVERY render type / variant the widget
    // supports: line/step/scatter/band, chart/readout/auto, time-X vs
    // phase-space X, thresholds, log scale, and aspect stress. All series get
    // explicit `id`s (used as React keys + ChartSeries ids) and explicit
    // `axis` so the "3+ units → AxisWarning" auto path doesn't fire unasked.
    modes: (() => {
      const WINDOW = 600;
      // Dual-axis line: altitude (left) + horizontal velocity (right).
      const dualLine = {
        windowSec: WINDOW,
        series: [
          {
            id: "alt",
            key: "vessel.state.altitudeAsl",
            label: "Altitude",
            axis: "primary",
          },
          {
            id: "hvel",
            key: "vessel.state.horizontalSpeed",
            label: "H. velocity",
            axis: "secondary",
          },
        ],
      };
      return [
        // ── WARMUP (slot 1 is sacrificial) ───────────────────────────────
        // The very first render in a harness batch is a cold path: the
        // async `useDataSeries` queryRange backfill consistently fails to
        // land before the screenshot, so whatever sits in slot 1 plots an
        // empty frame (axes + legend, no trace). This is a shared
        // probe-entry artifact (out of edit scope), NOT a Graph bug, every
        // type below renders its data correctly. This throwaway dual-axis
        // warmup absorbs the empty slot so no real type is sacrificed.
        { name: "warmup-ignore-10x8", w: 10, h: 8, config: dualLine },
        // ── line ────────────────────────────────────────────────────────
        // Single-series line (explicit chart so it doesn't downgrade).
        {
          name: "line-single-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                type: "line",
                axis: "primary",
              },
            ],
          },
        },
        // Dual-axis line, primary + secondary.
        { name: "line-dual-10x8", w: 10, h: 8, config: dualLine },

        // ── step ────────────────────────────────────────────────────────
        {
          name: "step-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "vs",
                key: "vessel.state.verticalSpeed",
                label: "V. speed (step)",
                type: "step",
                axis: "primary",
              },
            ],
          },
        },

        // ── scatter ─────────────────────────────────────────────────────
        {
          name: "scatter-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude (scatter)",
                type: "scatter",
                axis: "primary",
              },
            ],
          },
        },

        // Short-window scatter so only the most-recent handful of samples
        // fall in-window and the discrete dots are visibly separated (the
        // 600s-window scatter above merges 154 dense samples into a near-
        // continuous run, this proves the points actually draw discretely).
        {
          name: "scatter-sparse-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: 25,
            variant: "chart",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude (sparse scatter)",
                type: "scatter",
                axis: "primary",
              },
            ],
          },
        },

        // ── band ────────────────────────────────────────────────────────
        // Synthetic ±(10%+200m) envelope around altitude (see fixture _meta),
        // plus the real altitude line overlaid inside the band.
        {
          name: "band-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "altband",
                key: "synthetic.altBandLow",
                keyHigh: "synthetic.altBandHigh",
                label: "Altitude envelope",
                type: "band",
                axis: "primary",
              },
              {
                id: "altline",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                type: "line",
                axis: "primary",
              },
            ],
          },
        },

        // ── variant: readout / chart / auto at a tiny size ───────────────
        // readout: explicit, single series → number + sparkline.
        {
          name: "readout-6x5",
          w: 6,
          h: 5,
          config: {
            windowSec: WINDOW,
            variant: "readout",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                axis: "primary",
              },
            ],
          },
        },
        // auto at small bucket (w<8) + single series → downgrades to readout.
        {
          name: "auto-small-6x6",
          w: 6,
          h: 6,
          config: {
            windowSec: WINDOW,
            variant: "auto",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                axis: "primary",
              },
            ],
          },
        },
        // chart forced at the same tiny size, proves the chart still draws
        // when not allowed to downgrade.
        {
          name: "chart-tiny-6x6",
          w: 6,
          h: 6,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                axis: "primary",
              },
            ],
          },
        },

        // ── xKey = data key (phase-space) ────────────────────────────────
        // Altitude on X, vertical speed on Y, classic ascent profile.
        {
          name: "phase-space-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            xKey: "vessel.state.altitudeAsl",
            series: [
              {
                id: "vs",
                key: "vessel.state.verticalSpeed",
                label: "V. speed vs altitude",
                type: "line",
                axis: "primary",
              },
            ],
          },
        },

        // ── thresholds (dashed + solid) ──────────────────────────────────
        {
          name: "thresholds-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude",
                axis: "primary",
              },
            ],
            thresholds: [
              {
                id: "atmo",
                value: 70000,
                axis: "primary",
                label: "Atmosphere top",
                dashed: true,
              },
              {
                id: "tower",
                value: 10000,
                axis: "primary",
                label: "10 km",
                dashed: false,
              },
            ],
          },
        },

        // ── yScale log ───────────────────────────────────────────────────
        // Altitude (all positive, 77 → 67k) on a log primary axis.
        {
          name: "log-primary-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            yScalePrimary: "log",
            series: [
              {
                id: "alt",
                key: "vessel.state.altitudeAsl",
                label: "Altitude (log)",
                type: "line",
                axis: "primary",
              },
            ],
          },
        },

        // ── aspect stress ────────────────────────────────────────────────
        // Wide-short: stresses legend-drop + x-axis tick density.
        { name: "wide-16x5", w: 16, h: 5, config: dualLine },
        // Tall-narrow: stresses y-tick density + legend stacking.
        { name: "tall-7x16", w: 7, h: 16, config: dualLine },
        // Default operator view, both axes (safely past slot 1).
        { name: "default-10x8", w: 10, h: 8, config: dualLine },
      ];
    })(),
  },
  {
    widgetId: "orbital-ascent",
    fixturesPath: "OrbitalAscent/__fixtures__",
    outPath: "renders/orbital-ascent-widget",
    modes: [
      // minSize 5×4: phase-space plot at its tightest.
      { name: "min-5x4", w: 5, h: 4 },
      // defaultSize 10×8: the common operator view.
      { name: "default-10x8", w: 10, h: 8 },
      // tall: more vertical room for the velocity axis.
      { name: "tall-8x12", w: 8, h: 12 },
      // wide-short: stresses the chart's bottom-vs-side reflow.
      { name: "wide-16x6", w: 16, h: 6 },
    ],
  },
  {
    widgetId: "maneuver-planner",
    fixturesPath: "ManeuverPlanner/__fixtures__",
    outPath: "renders/maneuver-planner-widget",
    // Scoped to the INSTANT rows, and deliberately NOT the conformance rows,
    // which do clip at 6x9 now that four sections stack above them.
    //
    // The two differ in how cropping harms them, and that is the whole
    // criterion. Three instants share one axis, so losing the third changes what
    // the other two MEAN: a reader sees a two-instant burn and is not told
    // otherwise. A conformance row is self-contained ("180 of 300, 60%"), so
    // below the fold it is hidden and scrollable, not distorted.
    //
    // Recording the temptation because it was real: widening the selector and
    // then exempting 6x9 would have made the check pass and would have quietly
    // given up the one mode the instants are still checked at.
    //
    // A burn's three instants are a COMPARISON: "burn in 4min" is true of
    // whichever of them it came from and wrong about the other two, so a row
    // rendered below the panel edge is missing from the thing the section
    // exists to show, and every DOM assertion still passes on it. jsdom
    // computes no boxes, so this cannot live in the unit suite; it is only
    // answerable after a real browser has laid the widget out.
    mustBeVisible: {
      selector: "[data-burn-instant-row]",
      // TWO earned exemptions, and the interesting one is what is NOT here.
      // The 18x5 letterbox and the 9x8 mobile tile genuinely cannot hold three
      // rows and scroll, which is the accepted degradation: a row one scroll
      // down is legible, a row silently cropped is not. The 6x9 MINIMUM does
      // hold all three, so it stays checked. Copying the vessel-tracker list
      // wholesale would have exempted it too and quietly excused a mode that
      // passes, hiding the next regression there.
      //
      // Established per-mode by removing every exemption and reading what
      // actually failed, and the check itself was watched FAILING at a
      // deliberately-tiny 6x3 tile first, because a check never seen to fail is
      // not evidence of anything.
      //
      // min-6x9 was NOT exempt and did hold all three rows. The Plan/Conformance
      // tab strip is a fixed ~40px above the content and that was the whole
      // margin, so the cutoff row now sits below the fold. It stays reachable
      // (Panel's body is the scroller, so this is below-the-fold rather than
      // clipped-and-unreachable), which is the same accepted degradation as the
      // two sizes above, and the gate is what reported it rather than a reading
      // of the render.
      mayScroll: ["landscape-18x5", "mobile-9x8", "min-6x9"],
    },
    modes: [
      // minSize 6×9: node editor at its tightest.
      { name: "min-6x9", w: 6, h: 9 },
      // defaultSize 10×18: the common operator view.
      { name: "default-10x18", w: 10, h: 18 },
      // wide landscape.
      { name: "wide-14x12", w: 14, h: 12 },
      // The CONFORMANCE tab, which the default render never reaches: Plan is
      // the opening tab, so the plot is only rendered after a click. Selected
      // by the tab's id suffix rather than its text, since a CSS selector
      // cannot match on content and `useId`'s prefix moves with the mount.
      {
        name: "conformance-10x18",
        w: 10,
        h: 18,
        clicks: [{ selector: "[id$='conformance-tab']" }],
      },
      // The same tab at the widget's MINIMUM width, since every widget defect
      // found in this batch was at a small breakpoint.
      {
        name: "conformance-6x9",
        w: 6,
        h: 9,
        clicks: [{ selector: "[id$='conformance-tab']" }],
      },
    ],
  },
  {
    widgetId: "science-data",
    fixturesPath: "ScienceData/__fixtures__",
    outPath: "renders/science-data-widget",
    modes: [
      // minSize 4×4: Aboard tab, tight.
      {
        name: "min-4x4",
        w: 4,
        h: 4,
        forFixtures: ["kerbin-flight-partial-science"],
      },
      {
        name: "compact-5x7",
        w: 5,
        h: 7,
        forFixtures: ["kerbin-flight-partial-science"],
      },
      // defaultSize 8×10: the common operator view, Aboard tab (default-active).
      {
        name: "aboard-8x10",
        w: 8,
        h: 10,
        forFixtures: ["kerbin-flight-partial-science"],
      },
      {
        name: "aboard-wide-12x10",
        w: 12,
        h: 10,
        forFixtures: ["kerbin-flight-partial-science"],
      },
      // Archive tab: clicks the second tablist entry, scoped to the
      // cross-mission fixture so the body -> experiment grouping (and the
      // divergence from the Aboard tab's single-vessel breakdown) is visible.
      {
        name: "archive-8x10",
        w: 8,
        h: 10,
        clicks: [{ selector: '[role="tablist"] [role="tab"]:nth-of-type(2)' }],
        forFixtures: ["career-archive-multi-body"],
      },
      {
        name: "archive-wide-12x14",
        w: 12,
        h: 14,
        clicks: [{ selector: '[role="tablist"] [role="tab"]:nth-of-type(2)' }],
        forFixtures: ["career-archive-multi-body"],
      },
    ],
  },
  {
    // ScienceData's Aboard row, an ADDITIVE Kerbalism augment: the widget
    // itself (registered above) renders the row identically with no
    // Kerbalism data at all; the File Manager controls (Send/Delete/
    // Analyze/Dump/Move to lab, drive capacity readout) live entirely in
    // the Uplink (mod/GonogoKerbalismUplink/client/src/ScienceFileManager)
    // and fill the generic `science-data.aboard-row` slot this widget
    // exposes. Same widgetId, a dedicated fixtures dir and label (mirrors
    // crew-status/kerbalism-survival's convention) so this render set is
    // disambiguated from the base-widget one above.
    widgetId: "science-data",
    label: "science-data/kerbalism-file-manager",
    fixturesPath: "ScienceData/__render_kerbalism_file_manager__",
    outPath: "renders/kerbalism-science-file-manager",
    modes: [
      // defaultSize 8×10: the common operator view, every control visible.
      { name: "default-8x10", w: 8, h: 10 },
      // Wide/tall review shot: both the file and sample rows plus the drive
      // readout readable without scrolling.
      { name: "wide-12x12", w: 12, h: 12 },
    ],
  },
  {
    // Target Picker. Fixtures are SYNTHETIC (no live capture). Reads only the
    // `"data"` source (tar.* / b.* / o.* keys), no probe kos wiring needed.
    // The widget is a single scrolling view, not a tablist: the Suggested +
    // categorised sections (Bodies / Vessels / Parts / Other) plus the
    // current-target summary all render AT ONCE, so every list appears in a
    // static render with no reveal-clicks needed.
    widgetId: "target-picker",
    fixturesPath: "TargetPicker/__fixtures__",
    outPath: "renders/target-picker-widget",
    modes: [
      // Below the picker threshold (rows<6 || cols<4): compact current-target
      // readout (name + distance) or "No target set".
      { name: "compact-3x4", w: 3, h: 4 },
      // defaultSize 6×11: the full sectioned picker (Suggested + Bodies +
      // Vessels + Parts + Other) with the current-target summary when set.
      { name: "default-6x11", w: 6, h: 11 },
      // wide: the sections have horizontal room.
      { name: "wide-9x12", w: 9, h: 12 },
    ],
  },
  {
    // Transfer Window: client-derived interplanetary planner. Fixtures emit an
    // RSS Sun/Earth/Mars/Venus system + a LEO vessel + Mars targeted. Two states:
    // GO (phase on the Hohmann ideal) and HOLD (phase far off). The two modes
    // exercise the responsive reflow: default (stacked: dial + list, chart
    // below) and wide (side-by-side: list left, chart flowing right), and the
    // auto-appended portrait/landscape modes catch the aspect extremes.
    widgetId: "transfer-window",
    fixturesPath: "TransferWindow/__fixtures__",
    outPath: "renders/transfer-window",
    modes: [
      { name: "default-12x20", w: 12, h: 20 },
      { name: "wide-18x18", w: 18, h: 18 },
      // minSize 6x10, and the reach list is a TABLE: five columns at the
      // tightest placement the widget allows is where a table either wraps
      // legibly or overflows its panel. Rendered for the reach fixtures only,
      // since the older two carry no budget and so no verdict column to squeeze.
      {
        name: "min-6x10",
        w: 6,
        h: 10,
        forFixtures: ["earth-mars-reach-band", "earth-mars-no-budget"],
      },
    ],
  },
  {
    // kOS Terminal (mod/GonogoKosUplink/client/src/KosTerminal). A STREAM-DRIVEN
    // widget: it reads `kos.processors` / `kos.terminal.<coreId>` straight
    // off a mounted TelemetryProvider via `useStream`/`useStreamEvent`, never
    // through the `"data"`/`"kos"` DataSource registry the rest of this file
    // assumes. Its fixture therefore carries a top-level `_stream` block
    // (carriedChannels + pinnedUt + emits) instead of plain data keys; see
    // probe-entry.tsx's `_stream` fixture path. Fixture lives under
    // `packages/components/src/KosTerminal/__fixtures__` purely because
    // `fixturesPath` resolves against `packages/components/src/`, not
    // because the widget's source lives there (it doesn't).
    widgetId: "kos-terminal",
    fixturesPath: "KosTerminal/__fixtures__",
    outPath: "renders/kos-terminal-widget",
    modes: [
      // minSize 8×6: tightest placement the widget allows.
      { name: "min-8x6", w: 8, h: 6 },
      // defaultSize 18×15: the common operator view.
      { name: "default-18x15", w: 18, h: 15 },
      // wide: generous horizontal room; the terminal itself stays a fixed
      // 80×24 grid (KOS_TERM_COLS/ROWS) regardless of container size.
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
  // space-weather moved to
  // @ksp-gonogo/gonogo-kerbalism-uplink/scripts/widgets.ts with the widget
  // itself, its fixtures alongside it, the same way deployed-science and
  // robotics-console left with the Breaking Ground uplink.
  {
    // ShipMap: part diagram + the spec §13.4 self-contribution flagship
    // (`ship-map.part-meters` / `ship-map.part-meta`). A dedicated
    // `probe/` subfolder under the widget's own `__fixtures__/`, separate
    // from the SSR-only legacy `{ "v.topology": ... }` fixtures the
    // `render-ship-map` script + snapshot tests use: those carry no
    // `_stream` block, so the probe would render them as a permanent
    // "Waiting for vessel topology" placeholder. These two are authored
    // straight in the modern `vessel.parts` wire shape instead.
    widgetId: "ship-map",
    fixturesPath: "ShipMap/__fixtures__/probe",
    // The folder name says "colour" because the fills these renders show come
    // from the resource-colour system, so a reader comparing them against an
    // older render set knows which palette they are looking at.
    outPath: "renders/kerbalism-shipmap-colour",
    modes: [
      // Registered default.
      { name: "default-8x10", w: 8, h: 10 },
      // Wider/taller: the colour-spread fixture stacks four parts with
      // several meters each, the default size crops it.
      {
        name: "colour-spread-10x16",
        w: 10,
        h: 16,
        forFixtures: ["03-resource-colour-spread"],
      },
      // Water-family review shot: Water, WasteWater, Waste, CarbonDioxide,
      // and Oxygen (for contrast) across two parts, three meters on the
      // taller one, so all five bars read uncropped at once.
      {
        name: "water-family-10x14",
        w: 10,
        h: 14,
        forFixtures: ["04-water-family"],
      },
    ],
  },
  {
    // ShipSystems: Kerbalism vessel-wide resource ledger, replacing the
    // deleted LifeSupportSystems widget. Its actual source lives at
    // mod/GonogoKerbalismUplink/client/src/ShipSystems, the fixture stays
    // under packages/components/src/ShipSystems/__fixtures__ purely because
    // `fixturesPath` resolves against packages/components/src/ (see that
    // fixture's own `_meta` for the same convention). Drives the widget over
    // a real `setupStreamFixture` via probe-entry.tsx's `_stream` path.
    widgetId: "ship-systems",
    fixturesPath: "ShipSystems/__fixtures__",
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
      // Ledger accordion expanded: click the first supply row's Disclosure
      // trigger (Electric Charge, the root cause, sorted first) to reveal its
      // buildLedger terms. aria-label is the stable selector: Disclosure's
      // trigger is a plain <button> with no other hook, and this fixture's
      // profile always names Electric Charge's displayName the same way.
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
      // Same accordion, at the default and minimum widths: the shape that
      // caught the ledger overflowing the panel at anything narrower than
      // wide-12x18 (see LedgerBody's own doc comment).
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
      // Ledger DESIGN review shot: resource-shortage's Electric Charge only
      // has ONE ledger term (Water Recycler), which is not enough to judge a
      // bar that is meant to diverge either side of zero. ledger-showcase's
      // Electric Charge has five terms of mixed sign and varied magnitude
      // (a dominant +0.45/s producer down to a -0.003/s trickle), at both
      // the default and a generous width, so the diverging red/green
      // DivergingBar treatment is legible across several rows at once.
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
  {
    // FleetRoster: fleet-wide roster TABLE (one row per known vessel),
    // reading the real `system.vessels`/`system.bodies` Topics (stream
    // fixtures). Mixed-fleet exercises direct/relay/no-link/unknown comms
    // plus known/unknown crew; all-linked is the quiet-day baseline; empty
    // exercises the confirmed-zero-vessels state. There is no per-vessel
    // reliability/health signal here: SystemView owns the spatial view.
    widgetId: "fleet-roster",
    fixturesPath: "FleetRoster/__fixtures__",
    outPath: "renders/fleet-roster-widget",
    modes: [
      // Registered default: full table incl. Body column + the
      // fleet-roster.updates augment slot (empty until an uplink binds).
      { name: "default-8x10", w: 8, h: 10 },
      // Wide: generous room for long vessel names + the coverage footer.
      { name: "wide-11x10", w: 11, h: 10 },
      // Compact: sheds the Body column + per-vessel update lines.
      { name: "compact-5x7", w: 5, h: 7 },
      // Minimum size: tightest plausible placement.
      { name: "tiny-4x4", w: 4, h: 4 },
    ],
  },
];

/**
 * Mobile portrait approximation in grid units. 9w × 8h converts to
 * roughly 352 × 256 px via the harness's COL_WIDTH=32 / ROW_HEIGHT=25
 * / GRID_MARGIN=8 constants: close to a typical phone width (375 px
 * minus chrome) and an aspect ratio that matches the
 * `mobileHeight: 240`-shaped widgets the MobileDashboard renders.
 *
 * Appended automatically to every widget's `modes` array via
 * `withAutoMobileMode` below. New widgets get mobile DOM-snapshot +
 * PNG coverage without remembering to add an entry. Widgets with
 * mobile-specific layout quirks can opt out by declaring their own
 * `mobile-*` mode in WIDGETS: the helper skips appending when any
 * existing mode name starts with `mobile-`.
 *
 * Reported as needed in the 2026-05-18 self-test: the CameraFeed
 * `mobileHeight: 240` regression (gone unnoticed because no test
 * exercised mobile sizing) prompted this scaffolding addition.
 */
/**
 * Auto-appended modes every widget gets unless it already defines a mode with
 * the same name-prefix. Beyond `mobile-`, two ASPECT-EXTREME modes force the
 * portrait-vs-landscape reflow decisions that ordinary near-square modes never
 * exercise: a widget that docks a detail panel, legend, or secondary readout
 * has to flow it to the *bottom* in tall-narrow and to the *side* in
 * wide-short, and these catch when it doesn't.
 *
 * - `portrait-5x18` : tall + narrow (aspect ≈ 0.28): single-column, panel below
 * - `landscape-18x5`: wide + short (aspect ≈ 3.6): row layout, panel beside
 *
 * A widget with genuine aspect-specific layout can opt a given auto-mode out by
 * declaring its own mode with that name-prefix (`mobile-`/`portrait-`/`landscape-`).
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

export function listWidgets(): readonly WidgetRenderConfig[] {
  return WIDGETS.map(withAutoModes);
}

export function getWidget(id: string): WidgetRenderConfig | undefined {
  const found = WIDGETS.find((w) => (w.label ?? w.widgetId) === id);
  return found ? withAutoModes(found) : undefined;
}

/**
 * Screen-level render entries, the screen analog of WIDGETS. Each renders a
 * full-viewport view at several device breakpoints and visual states through
 * the shared `renderScreens` harness path (page-viewport resize + coarse
 * pointer emulation, so the screen's own `@media` rules engage). Driven from
 * the same `render-widget` CLI via `--screen <id>` / `--screens`.
 *
 * Why screens live here and not in `@ksp-gonogo/app`: the harness tooling
 * (playwright / esbuild / tsx) and the probe entries all live in
 * `@ksp-gonogo/components`, and app→components is the existing dependency edge,
 * a screen driver in app would have no harness to call. The screen VIEW
 * (`StationConnectView`) is a pure presentational component exported from
 * `@ksp-gonogo/components` and imported back by app's StationScreen, so there is
 * a single source of the markup the harness verifies.
 */
const SCREENS: ScreenRenderConfig[] = [
  {
    isScreen: true,
    screenId: "station-connect",
    outPath: "renders/station-connect-screen",
    // 375×667 (iPhone SE / 8 class), 480×812 (the inclusive boundary of the
    // max-width:480px rule on a tallish phone), 810×1080 (an iPad-class TOUCH
    // device above the 480 breakpoint: proves the coarse-pointer rules don't
    // break the still-horizontal Row), 768×1024 (the non-touch desktop
    // control proving the wide layout still reads).
    breakpoints: [
      { name: "iphone-375x667", width: 375, height: 667 },
      { name: "phone-480x812", width: 480, height: 812 },
      // Coarse pointer + wide: max-width:480 is OFF (Row stays horizontal) but
      // pointer:coarse is ON. Guards against a full-width button overflowing
      // the row beside the input: the case the 768 non-touch control misses.
      { name: "tablet-touch-810x1080", width: 810, height: 1080, touch: true },
      // Above the 480px breakpoint and explicitly non-touch: the desktop
      // control. If the wide layout regresses this is where it shows.
      { name: "tablet-768x1024", width: 768, height: 1024, touch: false },
    ],
    states: [
      // Fresh station, nothing typed: idle.
      {
        name: "idle",
        props: {
          hostInput: "",
          connStatus: "idle",
          hostNotFound: false,
          everConnected: false,
        },
      },
      // Code typed, connecting: button shows "Connecting…" + disabled.
      {
        name: "connecting",
        props: {
          hostInput: "AB3K",
          connStatus: "connecting",
          hostNotFound: false,
          everConnected: false,
        },
      },
      // Wrong / dead code, never connected: the hard nogo error.
      {
        name: "not-found",
        props: {
          hostInput: "ZZ9Q",
          connStatus: "disconnected",
          hostNotFound: true,
          everConnected: false,
        },
      },
      // Previously connected, host mid-reclaim: the softer reconnect notice.
      {
        name: "reconnecting",
        props: {
          hostInput: "AB3K",
          connStatus: "reconnecting",
          hostNotFound: true,
          everConnected: true,
        },
      },
    ],
  },
];

export function listScreens(): readonly ScreenRenderConfig[] {
  return SCREENS;
}

export function getScreen(id: string): ScreenRenderConfig | undefined {
  return SCREENS.find((s) => s.screenId === id);
}
