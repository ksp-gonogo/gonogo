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
import type { WidgetRenderConfig } from "./widgetRenderHarness";

const WIDGETS: WidgetRenderConfig[] = [
  {
    // MapView paints to <canvas> (equirectangular body texture + fog
    // overlay + vessel trail). The playwright harness captures the
    // canvas pixels directly — no parallel SVG renderer needed for
    // visual coverage, just the standard fixture/mode pattern. The DOM
    // snapshot test snaps the chrome around the canvas (which is the
    // useful structural-regression layer); canvas pixels live only in
    // the PNG harness, which we don't pixel-diff.
    widgetId: "map-view",
    fixturesPath: "MapView/__fixtures__",
    outPath: "renders/map-view-widget",
    modes: [
      // Minimum size — chrome thin, body fill dominates.
      { name: "tiny-3x4", w: 3, h: 4 },
      // Square small — confirms aspect-fit doesn't squish the map.
      { name: "square-6x6", w: 6, h: 6 },
      // Default registered size.
      { name: "default-12x18", w: 12, h: 18 },
      // Wide landscape — equirectangular projection reads best here.
      { name: "wide-18x10", w: 18, h: 10 },
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
      // controlMode degrades to dial-only — same display as a wide-mode
      // widget. Useful for catching regressions to the degrade path.
      { name: "degraded-7x12", w: 7, h: 12, config: { controlMode: true } },
      // Minimum sensible control-mode size; everything above lights up
      // the SAS / throttle / FBW surface.
      { name: "full-7x20", w: 7, h: 20, config: { controlMode: true } },
      // Generous control-mode size that lets every group breathe.
      { name: "xl-9x24", w: 9, h: 24, config: { controlMode: true } },
    ],
  },
  {
    widgetId: "orbit-view",
    fixturesPath: "OrbitView/__fixtures__",
    outPath: "renders/orbit-view-widget",
    modes: [
      // Pill fallback — both thresholds unmet; only status pill rendered.
      { name: "pill-3x3", w: 3, h: 3 },
      // Landscape-relaxed diagram — cols≥8 && rows≥3 branch.
      { name: "landscape-10x3", w: 10, h: 3 },
      // Minimum square diagram — just above the 5×5 threshold.
      { name: "square-5x5", w: 5, h: 5 },
      // Default registered size for the widget.
      { name: "default-9x18", w: 9, h: 18 },
      // Generous size — body, orbit, and labels have plenty of room.
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
      // 5×8: all rows + diagram slot (rows=8, cols=5 — exactly on threshold).
      { name: "medium-5x8", w: 5, h: 8 },
      // Default size: every row + generous diagram.
      { name: "default-9x18", w: 9, h: 18 },
      // Landscape: wide and shallow — ResizeObserver flips flex-direction.
      { name: "landscape-12x6", w: 12, h: 6 },
    ],
  },
  {
    widgetId: "twr",
    fixturesPath: "Twr/__fixtures__",
    outPath: "renders/twr-widget",
    modes: [
      // Tiny variant — numeric readout only.
      { name: "tiny-2x2", w: 2, h: 2 },
      // Small — gauge only, no sparkline.
      { name: "small-3x3", w: 3, h: 3 },
      // Default — gauge + sparkline + subtitle.
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
      // Documented minimum — confirms the graph doesn't overflow.
      { name: "min-5x4", w: 5, h: 4 },
      // Default size — the most common operator view.
      { name: "default-10x8", w: 10, h: 8 },
      // Tall narrow — useful for a sidebar column.
      { name: "tall-6x12", w: 6, h: 12 },
      // Wide short — approximates a bottom-bar placement.
      { name: "wide-14x6", w: 14, h: 6 },
      // Large — confirms the Kepler curve stays proportional.
      { name: "xl-14x12", w: 14, h: 12 },
    ],
  },
  {
    widgetId: "semi-major-axis",
    fixturesPath: "SemiMajorAxis/__fixtures__",
    outPath: "renders/semi-major-axis-widget",
    modes: [
      // No subtitle, no sparkline — value only.
      { name: "tiny-3x3", w: 3, h: 3 },
      // Subtitle appears, sparkline still suppressed (cols<3).
      { name: "subtitle-2x4", w: 2, h: 4 },
      // Default — subtitle + sparkline both visible.
      { name: "default-4x4", w: 4, h: 4 },
      // Extra vertical room — sparkline has more breathing space.
      { name: "medium-5x6", w: 5, h: 6 },
      // Generous width — sparkline fully expanded.
      { name: "wide-8x8", w: 8, h: 8 },
    ],
  },
  {
    widgetId: "atmosphere-profile",
    fixturesPath: "AtmosphereProfile/__fixtures__",
    outPath: "renders/atmosphere-profile-widget",
    modes: [
      // Minimum widget size — tests that the chart area doesn't collapse.
      { name: "min-5x4", w: 5, h: 4 },
      // Comfortable single-column size.
      { name: "medium-6x8", w: 6, h: 8 },
      // Default dashboard size.
      { name: "default-8x8", w: 8, h: 8 },
      // Taller layout — good for reading the log Y axis clearly.
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
    widgetId: "distance-to-target",
    fixturesPath: "DistanceToTarget/__fixtures__",
    outPath: "renders/distance-to-target-widget",
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
    widgetId: "landing-status",
    fixturesPath: "LandingStatus/__fixtures__",
    outPath: "renders/landing-status-widget",
    modes: [
      // Minimum size — suicide-burn row only.
      { name: "compact-4x5", w: 4, h: 5 },
      // Subtitle appears + impact/speed rows begin.
      { name: "medium-6x7", w: 6, h: 7 },
      // Altitude + descent rows added (rows>=8).
      { name: "standard-6x9", w: 6, h: 9 },
      // Default size: full metric grid + best-impact-inline.
      { name: "default-8x10", w: 8, h: 10 },
      // Tall atmospheric view: rows>=9 unlocks the ambient section.
      { name: "tall-atm-8x12", w: 8, h: 12 },
    ],
  },
  {
    widgetId: "comm-signal",
    fixturesPath: "CommSignal/__fixtures__",
    outPath: "renders/comm-signal-widget",
    modes: [
      // Minimum size — bars + headline only, no subtitle or detail grid
      // (rows<4 suppresses both). Catches overflow at tight sizes.
      { name: "min-3x3", w: 3, h: 3 },
      // Default registered size — bars, subtitle, and full detail grid.
      { name: "default-6x5", w: 6, h: 5 },
      // Tall narrow — detail grid wraps in a single column layout.
      { name: "tall-4x7", w: 4, h: 7 },
      // Wide short — subtitle visible, grid has generous horizontal room.
      { name: "wide-9x4", w: 9, h: 4 },
      // Generous size — full content, comfortable spacing.
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
      // Compact — facility grid in 2-col (cols<5), no full-text tier bodies.
      { name: "compact-4x7", w: 4, h: 7 },
      // Default registered size — 3-col facility grid, subtitle with funds.
      { name: "default-6x7", w: 6, h: 7 },
      // Wide — 3-col grid has room to breathe; tier text bodies appear.
      { name: "wide-9x10", w: 9, h: 10 },
      // Tall — scroll area gets plenty of vertical room for tier descriptions.
      { name: "tall-6x14", w: 6, h: 14 },
    ],
  },
  {
    widgetId: "thermal-status",
    fixturesPath: "ThermalStatus/__fixtures__",
    outPath: "renders/thermal-status-widget",
    modes: [
      // Minimum size (3×4) — pill only, no detail rows (rows<5 suppresses
      // hottest-part row). Verifies the pill + EmptyState render cleanly.
      { name: "pill-only-3x4", w: 3, h: 4 },
      // 4×5 — hottest-part row unlocks (rows>=5), engine still hidden.
      { name: "hottest-only-4x5", w: 4, h: 5 },
      // 5×6 — engine row added (rows>=6). Just below the cols>=6 threshold
      // for the inline alert note (only 5 cols), so alert is pill-only.
      { name: "two-rows-5x6", w: 5, h: 6 },
      // Default size — all rows when shield data present (rows>=7).
      // cols>=6 so inline alert note renders in critical fixtures.
      { name: "default-8x7", w: 8, h: 7 },
      // Larger — generous scroll area for all rows + breathing room.
      { name: "large-10x10", w: 10, h: 10 },
    ],
  },
  {
    widgetId: "mission-director",
    fixturesPath: "MissionDirector/__fixtures__",
    outPath: "renders/mission-director-widget",
    modes: [
      // Minimum size — title only, no subtitle (h<4 branch). Catches
      // overflow on the tightest plausible placement.
      { name: "tiny-4x3", w: 4, h: 3 },
      // Compact — title + subtitle; contract cards start rendering.
      { name: "compact-4x5", w: 4, h: 5 },
      // Default registered size — subtitle + full card list + scroll.
      { name: "default-6x8", w: 6, h: 8 },
      // Wider layout — lets long contract titles + reward rows breathe.
      { name: "wide-8x10", w: 8, h: 10 },
      // Tall layout — more contracts visible without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
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
      // Minimum registered size — subtitle visible (h>=4), compact ship list.
      { name: "min-4x6", w: 4, h: 6 },
      // Default registered size — comfortable ship list + crew grid.
      { name: "default-7x10", w: 7, h: 10 },
      // Tall narrow — long ship list, crew grid stacks tight.
      { name: "tall-5x14", w: 5, h: 14 },
      // Wide landscape — buttons and rows have horizontal breathing room.
      { name: "wide-10x7", w: 10, h: 7 },
      // Click-driven modes — capture the arm-then-confirm sequences
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
    ],
  },
  {
    widgetId: "action-group",
    fixturesPath: "ActionGroup/__fixtures__",
    outPath: "renders/action-group-widget",
    modes: [
      // Minimum size (3×3) — tiny bucket (w<5): state pill + label only;
      // no toggle button (rows<4), no UnavailableNotice, no bell.
      { name: "tiny-3x3", w: 3, h: 3 },
      // 3×4 — toggle button unlocks (rows>=4); still tiny bucket (w<5) so
      // OfficialName and bell are suppressed.
      { name: "compact-3x4", w: 3, h: 4, config: { actionGroupId: "RCS" } },
      // 6×4 — normal bucket: OfficialName visible (cols>=5), toggle present.
      // Gear group with custom label exercises the OfficialName secondary line.
      {
        name: "normal-6x4",
        w: 6,
        h: 4,
        config: { actionGroupId: "Gear", label: "Landing Gear" },
      },
      // Default registered size (6×6) — full UI with custom label.
      {
        name: "default-6x6",
        w: 6,
        h: 6,
        config: { actionGroupId: "AG1", label: "Chutes" },
      },
      // Wide — label + OfficialName strip have generous horizontal room.
      { name: "wide-9x6", w: 9, h: 6, config: { actionGroupId: "SAS" } },
    ],
  },
  {
    widgetId: "fuel-status",
    fixturesPath: "FuelStatus/__fixtures__",
    outPath: "renders/fuel-status-widget",
    modes: [
      // rows=3, cols=3: showTotals=false, showHeroDv=true if totalDv set.
      // No subtitle, no resources, no stages — hero ΔV branch.
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
      // Compact path: cols<6 || rows<8 — shows resource name + net rate only.
      { name: "tiny-3x3", w: 3, h: 3 },
      // Compact with header visible (rows>=4 → showHeader=true, still !showFullList).
      { name: "compact-4x5", w: 4, h: 5 },
      // Exactly on the full-list threshold (cols=6, rows=8) — full layout.
      { name: "threshold-6x8", w: 6, h: 8 },
      // Default registered size — totals row, all three sections visible.
      { name: "default-8x12", w: 8, h: 12 },
      // Generous size — every section breathes; STORED cell visible when present.
      { name: "wide-12x16", w: 12, h: 16 },
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
      // default registered size — the most common operator view.
      { name: "default-5x9", w: 5, h: 9 },
      // tall: generous vertical room; long effect lists and all three sections
      // (Active / Available / Locked) can breathe without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
      // wide: exercises the horizontal layout at normal bucket; header meta
      // bar (funds / rep / sci readouts) has more room to spread.
      { name: "wide-9x12", w: 9, h: 12 },
    ],
  },
];

export function listWidgets(): readonly WidgetRenderConfig[] {
  return WIDGETS;
}

export function getWidget(id: string): WidgetRenderConfig | undefined {
  return WIDGETS.find((w) => w.widgetId === id);
}
