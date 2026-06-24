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
      // ── SCANsat extension showcase (scoped to the synthetic scansat
      //    fixture). Each mode isolates one of the three new capabilities
      //    so an orientation / layer / panel regression is visible. ──────
      // Base scan layers: biome base + elevation shading + anomaly
      // markers. Confirms N-up / E-right orientation against the known
      // fixture features (KSC near prime meridian, NE + SW mountain
      // ranges, south ice cap > north, centred ocean).
      {
        name: "scansat-layers-18x12",
        w: 18,
        h: 12,
        config: {
          baseLayer: "biome",
          showHeightShading: true,
          showAnomalies: true,
        },
        forFixtures: ["kerbin-scansat"],
      },
      // B — scanning-vessel footprint overlay + coverage readout. Two
      // Kerbin vessels (cyan + amber) draw footprints; a third on Mun is
      // filtered out. Coverage readout sits below the map.
      {
        name: "scansat-footprints-18x14",
        w: 18,
        h: 14,
        config: {
          baseLayer: "biome",
          showFootprints: true,
          showCoverage: true,
          showAnomalies: true,
        },
        forFixtures: ["kerbin-scansat"],
      },
      // C — anomaly distance/bearing side-panel beside the map.
      {
        name: "scansat-anomaly-panel-14x12",
        w: 14,
        h: 12,
        config: {
          baseLayer: "biome",
          showAnomalies: true,
          showAnomalyPanel: true,
        },
        forFixtures: ["kerbin-scansat"],
      },
      // A — body picker pinned to a NON-active body (Mun). Kerbin layers,
      // footprints, vessel marker + trail + prediction all vanish; the
      // label reads "Mun (pinned)". Proves the picker decouples from
      // v.body. (Mun has no fixture grids, so the base is the body wash.)
      {
        name: "scansat-pin-mun-14x12",
        w: 14,
        h: 12,
        config: {
          baseLayer: "biome",
          bodyOverride: "Mun",
          showFootprints: true,
          showAnomalies: true,
          showAnomalyPanel: true,
        },
        forFixtures: ["kerbin-scansat"],
      },
      // Everything on, at the default registered size, so the showcase
      // also exercises the panels at the common operator placement.
      {
        name: "scansat-all-12x18",
        w: 12,
        h: 18,
        config: {
          baseLayer: "biome",
          showHeightShading: true,
          showAnomalies: true,
          showFootprints: true,
          showCoverage: true,
          showAnomalyPanel: true,
        },
        forFixtures: ["kerbin-scansat"],
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
    widgetId: "contract-manager",
    fixturesPath: "ContractManager/__fixtures__",
    outPath: "renders/contract-manager-widget",
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
      // Launch-site picker — only renders after a ship is selected, so
      // click the first (affordable) ship row to reveal it. Scoped to the
      // pre-launch fixture that carries multi-site kc.launchSites.
      {
        name: "site-picker-7x18",
        w: 7,
        h: 18,
        clicks: [{ selector: "[data-ship-row]" }],
        forFixtures: ["pre-launch-mixed"],
      },
    ],
  },
  {
    widgetId: "deployed-base-monitor",
    fixturesPath: "DeployedBaseMonitor/__fixtures__",
    outPath: "renders/deployed-base-monitor-widget",
    modes: [
      // Minimum size — base header + first experiment, rest scrolls.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size — a base card with its experiments.
      { name: "default-5x9", w: 5, h: 9 },
      // Tall — multiple bases stacked.
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
      // Minimum size — readout + controls, list tight.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size — readout + controls + joint list.
      { name: "default-5x8", w: 5, h: 8 },
      // Wide — controls and list get horizontal room.
      { name: "wide-9x6", w: 9, h: 6 },
      // DLC-absent empty state.
      { name: "unavailable-5x8", w: 5, h: 8, forFixtures: ["unavailable"] },
    ],
  },
  {
    widgetId: "mission-status",
    fixturesPath: "MissionStatus/__fixtures__",
    outPath: "renders/mission-status-widget",
    modes: [
      // Minimum size — name + phase/banner, checklist tight.
      { name: "min-3x4", w: 3, h: 4 },
      // Default registered size — name, score, full checklist.
      { name: "default-5x7", w: 5, h: 7 },
      // Tall — long checklist with descriptions.
      { name: "tall-5x12", w: 5, h: 12 },
    ],
  },
  {
    widgetId: "rotor-tachometer",
    fixturesPath: "RotorTachometer/__fixtures__",
    outPath: "renders/rotor-tachometer-widget",
    modes: [
      // Minimum registered size (h<6) — gauge suppressed, controls + list.
      { name: "min-4x4", w: 4, h: 4 },
      // Default registered size — dial + controls + 2-rotor list.
      { name: "default-5x9", w: 5, h: 9 },
      // Wide — controls and list get horizontal room.
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
  {
    widgetId: "action-group",
    fixturesPath: "ActionGroup/__fixtures__",
    outPath: "renders/action-group-widget",
    modes: [
      // Minimum size (3×3) — tiny bucket (w<5): label + the ON/OFF state pill
      // (itself the toggle button); no UnavailableNotice, no bell.
      { name: "tiny-3x3", w: 3, h: 3 },
      // 3×4 — still tiny bucket (w<5) so OfficialName and bell are suppressed;
      // the state-pill toggle is present at every size.
      { name: "compact-3x4", w: 3, h: 4, config: { actionGroupId: "RCS" } },
      // 6×4 — normal bucket: OfficialName visible (cols>=5), state-pill toggle
      // present. Gear group with custom label exercises the secondary line.
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
  // ── Wave 2 (2026-05-29): widgets fixtured from a live career capture
  //    (Kerbin orbit, Mk1 pod). See local_docs/.../captures/. ─────────────
  {
    widgetId: "crew-manifest",
    fixturesPath: "CrewManifest/__fixtures__",
    outPath: "renders/crew-manifest-widget",
    modes: [
      // minSize 3×3 — single-crew row, tightest placement.
      { name: "tiny-3x3", w: 3, h: 3 },
      // defaultSize 6×8 — the common operator view.
      { name: "default-6x8", w: 6, h: 8 },
      // wide/tall — roomy crew list.
      { name: "wide-9x10", w: 9, h: 10 },
    ],
  },
  {
    widgetId: "staff-roster",
    fixturesPath: "StaffRoster/__fixtures__",
    outPath: "renders/staff-roster-widget",
    modes: [
      // minSize 2×2 — compact tally.
      { name: "tiny-2x3", w: 2, h: 3 },
      // defaultSize 5×7 — roster list with traits/availability.
      { name: "default-5x7", w: 5, h: 7 },
      // tall — full four-kerbal roster without scrolling.
      { name: "tall-6x14", w: 6, h: 14 },
      // wide — trait/level/availability columns have room.
      { name: "wide-9x10", w: 9, h: 10 },
    ],
  },
  {
    widgetId: "science-officer",
    fixturesPath: "ScienceOfficer/__fixtures__",
    outPath: "renders/science-officer-widget",
    modes: [
      // minSize 3×4 — instrument list, tight.
      { name: "min-3x4", w: 3, h: 4 },
      // defaultSize 6×7 — the common view.
      { name: "default-6x7", w: 6, h: 7 },
      // wide — instrument rows + status have room.
      { name: "wide-9x10", w: 9, h: 10 },
    ],
  },
  {
    widgetId: "tech-tree",
    fixturesPath: "TechTree/__fixtures__",
    outPath: "renders/tech-tree-widget",
    modes: [
      // minSize 2×2 — tightest; tally / degraded.
      { name: "tiny-3x4", w: 3, h: 4 },
      // defaultSize 6×9 — the common operator view.
      { name: "default-6x9", w: 6, h: 9 },
      // tall — more of the tree visible without scrolling.
      { name: "tall-6x16", w: 6, h: 16 },
      // wide landscape — closest to an in-game tech-tree aspect.
      { name: "wide-16x10", w: 16, h: 10 },
      // large — generous room for a node-graph layout.
      { name: "xl-18x16", w: 18, h: 16 },
    ],
  },
  {
    widgetId: "system-view",
    fixturesPath: "SystemView/__fixtures__",
    outPath: "renders/system-view-widget",
    modes: [
      // minSize 3×4 — smallest diagram.
      { name: "min-3x4", w: 3, h: 4 },
      // square — confirms the system diagram doesn't squish.
      { name: "square-6x6", w: 6, h: 6 },
      // defaultSize 10×12 — the common operator view.
      { name: "default-10x12", w: 10, h: 12 },
      // wide landscape.
      { name: "wide-14x10", w: 14, h: 10 },
    ],
  },
  {
    widgetId: "graph",
    fixturesPath: "Graph/__fixtures__",
    outPath: "renders/graph-widget",
    // Graph is config-driven: the per-mode `config` carries the series list +
    // render options; the fixture supplies the `_series` data those keys plot
    // against. This matrix exercises EVERY render type / variant the widget
    // supports — line/step/scatter/band, chart/readout/auto, time-X vs
    // phase-space X, thresholds, log scale, and aspect stress. All series get
    // explicit `id`s (used as React keys + ChartSeries ids) and explicit
    // `axis` so the "3+ units → AxisWarning" auto path doesn't fire unasked.
    modes: (() => {
      const WINDOW = 600;
      // Dual-axis line: altitude (left) + horizontal velocity (right).
      const dualLine = {
        windowSec: WINDOW,
        series: [
          { id: "alt", key: "v.altitude", label: "Altitude", axis: "primary" },
          {
            id: "hvel",
            key: "v.horizontalVelocity",
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
        // probe-entry artifact (out of edit scope), NOT a Graph bug — every
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
                key: "v.altitude",
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
                key: "v.verticalSpeed",
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
                key: "v.altitude",
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
        // continuous run — this proves the points actually draw discretely).
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
                key: "v.altitude",
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
                key: "v.altitude",
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
                key: "v.altitude",
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
                key: "v.altitude",
                label: "Altitude",
                axis: "primary",
              },
            ],
          },
        },
        // chart forced at the same tiny size — proves the chart still draws
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
                key: "v.altitude",
                label: "Altitude",
                axis: "primary",
              },
            ],
          },
        },

        // ── xKey = data key (phase-space) ────────────────────────────────
        // Altitude on X, vertical speed on Y — classic ascent profile.
        {
          name: "phase-space-10x8",
          w: 10,
          h: 8,
          config: {
            windowSec: WINDOW,
            variant: "chart",
            xKey: "v.altitude",
            series: [
              {
                id: "vs",
                key: "v.verticalSpeed",
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
                key: "v.altitude",
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
                key: "v.altitude",
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
      // minSize 5×4 — phase-space plot at its tightest.
      { name: "min-5x4", w: 5, h: 4 },
      // defaultSize 10×8 — the common operator view.
      { name: "default-10x8", w: 10, h: 8 },
      // tall — more vertical room for the velocity axis.
      { name: "tall-8x12", w: 8, h: 12 },
      // wide-short — stresses the chart's bottom-vs-side reflow.
      { name: "wide-16x6", w: 16, h: 6 },
    ],
  },
  {
    widgetId: "maneuver-planner",
    fixturesPath: "ManeuverPlanner/__fixtures__",
    outPath: "renders/maneuver-planner-widget",
    modes: [
      // minSize 6×9 — node editor at its tightest.
      { name: "min-6x9", w: 6, h: 9 },
      // defaultSize 10×18 — the common operator view.
      { name: "default-10x18", w: 10, h: 18 },
      // wide landscape.
      { name: "wide-14x12", w: 14, h: 12 },
    ],
  },
  {
    widgetId: "science-bench",
    fixturesPath: "ScienceBench/__fixtures__",
    outPath: "renders/science-bench-widget",
    modes: [
      // minSize 4×4 — compact experiment list.
      { name: "min-4x4", w: 4, h: 4 },
      { name: "compact-5x7", w: 5, h: 7 },
      // defaultSize 8×10 — the common operator view.
      { name: "default-8x10", w: 8, h: 10 },
      { name: "wide-12x10", w: 12, h: 10 },
    ],
  },
  {
    widgetId: "ground-survey",
    fixturesPath: "GroundSurvey/__fixtures__",
    outPath: "renders/ground-survey-widget",
    modes: [
      // minSize 3×3 — readout-only.
      { name: "tiny-3x3", w: 3, h: 3 },
      { name: "compact-5x5", w: 5, h: 5 },
      // defaultSize 8×7 — the common operator view.
      { name: "default-8x7", w: 8, h: 7 },
      { name: "wide-12x8", w: 12, h: 8 },
    ],
  },
  {
    // SCANsat. Fixture is SYNTHETIC (no live capture) — structured so the
    // biome minimap + fog swath + anomaly markers + coverage bars all render.
    widgetId: "scanning",
    fixturesPath: "Scanning/__fixtures__",
    outPath: "renders/scanning-widget",
    modes: [
      // minSize 3×4 — coverage bars only (minimap needs more room).
      { name: "min-3x4", w: 3, h: 4 },
      // defaultSize 6×10 — minimap + coverage + scanner list.
      { name: "default-6x10", w: 6, h: 10 },
      // tall — full minimap + every section.
      { name: "tall-6x16", w: 6, h: 16 },
      // wide — minimap has room alongside the readouts.
      { name: "wide-12x10", w: 12, h: 10 },
    ],
  },
  {
    // kOS Processors. Fixture is SYNTHETIC (no live LIST PROCESSORS capture)
    // — three CPUs (tagged 'system', tagged boot, untagged idle) so the row
    // chrome, mode dots, and pills all render. Reads the `"kos"` source +
    // `useKosScriptStatus`; the probe registers an unbuffered ProbeKosDataSource
    // under id "kos" with a static healthy topic status.
    widgetId: "kos-processors",
    fixturesPath: "KosProcessors/__fixtures__",
    outPath: "renders/kos-processors-widget",
    modes: [
      // minSize 3×3 — neither full nor compact rows; compact summary count.
      { name: "tiny-3x3", w: 3, h: 3 },
      // rows>=4, cols<5 — compact rows (tag + mode only, no pills).
      { name: "compact-4x5", w: 4, h: 5 },
      // rows>=6, cols>=5 — full rows: tag, mode, part title, vol/boot pills.
      { name: "default-6x8", w: 6, h: 8 },
      // tall — full rows with generous scroll room.
      { name: "tall-6x14", w: 6, h: 14 },
      // wide — full rows, horizontal breathing room.
      { name: "wide-10x8", w: 10, h: 8 },
    ],
  },
  {
    // Target Picker. Fixtures are SYNTHETIC (no live capture). Reads only the
    // `"data"` source (tar.* / b.* / o.* keys) — no probe kos wiring needed.
    // Defaults to the Bodies tab, so the base modes show the body tree +
    // header TARGET chip + OrbitalEventChips. The Vessels and Current tabs
    // are reached only via clicks — `role="tab"` buttons inside the tablist,
    // selected by position (2 = Vessels, 3 = Current). The vessel-list and
    // current-target panels would never appear in a static render otherwise.
    widgetId: "target-picker",
    fixturesPath: "TargetPicker/__fixtures__",
    outPath: "renders/target-picker-widget",
    modes: [
      // Below the tabs threshold (rows<6 || cols<4): compact current-target
      // readout (name + distance) or "No target set".
      { name: "compact-3x4", w: 3, h: 4 },
      // defaultSize 6×11 — tabbed picker, Bodies tab (default) with the tree.
      { name: "default-6x11", w: 6, h: 11 },
      // Vessels tab — distance-sorted tar.availableVessels list + asteroid toggle.
      {
        name: "vessels-6x11",
        w: 6,
        h: 11,
        clicks: [{ selector: '[role="tablist"] [role="tab"]:nth-of-type(2)' }],
      },
      // Current tab — selected target's name / type / distance / Δv + Clear.
      {
        name: "current-6x11",
        w: 6,
        h: 11,
        clicks: [{ selector: '[role="tablist"] [role="tab"]:nth-of-type(3)' }],
      },
      // wide — tabs + body tree have horizontal room.
      { name: "wide-9x12", w: 9, h: 12 },
    ],
  },
];

/**
 * Mobile portrait approximation in grid units. 9w × 8h converts to
 * roughly 352 × 256 px via the harness's COL_WIDTH=32 / ROW_HEIGHT=25
 * / GRID_MARGIN=8 constants — close to a typical phone width (375 px
 * minus chrome) and an aspect ratio that matches the
 * `mobileHeight: 240`-shaped widgets the MobileDashboard renders.
 *
 * Appended automatically to every widget's `modes` array via
 * `withAutoMobileMode` below. New widgets get mobile DOM-snapshot +
 * PNG coverage without remembering to add an entry. Widgets with
 * mobile-specific layout quirks can opt out by declaring their own
 * `mobile-*` mode in WIDGETS — the helper skips appending when any
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
 * exercise — a widget that docks a detail panel, legend, or secondary readout
 * has to flow it to the *bottom* in tall-narrow and to the *side* in
 * wide-short, and these catch when it doesn't.
 *
 * - `portrait-5x18`  — tall + narrow (aspect ≈ 0.28): single-column, panel below
 * - `landscape-18x5` — wide + short (aspect ≈ 3.6): row layout, panel beside
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
  const found = WIDGETS.find((w) => w.widgetId === id);
  return found ? withAutoModes(found) : undefined;
}

/**
 * Screen-level render entries — the screen analog of WIDGETS. Each renders a
 * full-viewport view at several device breakpoints and visual states through
 * the shared `renderScreens` harness path (page-viewport resize + coarse
 * pointer emulation, so the screen's own `@media` rules engage). Driven from
 * the same `render-widget` CLI via `--screen <id>` / `--screens`.
 *
 * Why screens live here and not in `@gonogo/app`: the harness tooling
 * (playwright / esbuild / tsx) and the probe entries all live in
 * `@gonogo/components`, and app→components is the existing dependency edge —
 * a screen driver in app would have no harness to call. The screen VIEW
 * (`StationConnectView`) is a pure presentational component exported from
 * `@gonogo/components` and imported back by app's StationScreen, so there is
 * a single source of the markup the harness verifies.
 */
const SCREENS: ScreenRenderConfig[] = [
  {
    isScreen: true,
    screenId: "station-connect",
    outPath: "renders/station-connect-screen",
    // 375×667 (iPhone SE / 8 class), 480×812 (the inclusive boundary of the
    // max-width:480px rule on a tallish phone), 810×1080 (an iPad-class TOUCH
    // device above the 480 breakpoint — proves the coarse-pointer rules don't
    // break the still-horizontal Row), 768×1024 (the non-touch desktop
    // control proving the wide layout still reads).
    breakpoints: [
      { name: "iphone-375x667", width: 375, height: 667 },
      { name: "phone-480x812", width: 480, height: 812 },
      // Coarse pointer + wide: max-width:480 is OFF (Row stays horizontal) but
      // pointer:coarse is ON. Guards against a full-width button overflowing
      // the row beside the input — the case the 768 non-touch control misses.
      { name: "tablet-touch-810x1080", width: 810, height: 1080, touch: true },
      // Above the 480px breakpoint and explicitly non-touch: the desktop
      // control. If the wide layout regresses this is where it shows.
      { name: "tablet-768x1024", width: 768, height: 1024, touch: false },
    ],
    states: [
      // Fresh station, nothing typed — idle.
      {
        name: "idle",
        props: {
          hostInput: "",
          connStatus: "idle",
          hostNotFound: false,
          everConnected: false,
        },
      },
      // Code typed, connecting — button shows "Connecting…" + disabled.
      {
        name: "connecting",
        props: {
          hostInput: "AB3K",
          connStatus: "connecting",
          hostNotFound: false,
          everConnected: false,
        },
      },
      // Wrong / dead code, never connected — the hard nogo error.
      {
        name: "not-found",
        props: {
          hostInput: "ZZ9Q",
          connStatus: "disconnected",
          hostNotFound: true,
          everConnected: false,
        },
      },
      // Previously connected, host mid-reclaim — the softer reconnect notice.
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
