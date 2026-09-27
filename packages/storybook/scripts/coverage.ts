/**
 * What the generator cannot derive from the render configs: the widgets with
 * no fixture at all, and which scene shows each registered augment or
 * contribution switched on in its host. The `Coverage` story holds both lists
 * to the live registries, so a widget or extension registered later and named
 * nowhere here fails the smoke check.
 */

/** A registered widget with no fixture, mounted unfed at a tile it accepts. */
export interface UnfixturedWidget {
  widgetId: string;
  w: number;
  h: number;
  reason: string;
}

export const UNFIXTURED_WIDGETS: readonly UnfixturedWidget[] = [
  {
    widgetId: "libration-points",
    w: 8,
    h: 10,
    reason: "Its catalogue scenes live in an integration test, not a fixture.",
  },
  {
    widgetId: "perf-budgets",
    w: 6,
    h: 8,
    reason: "It reads the page's own PerfBudget registry, not telemetry.",
  },
];

/** One extension, on the host scene that exercises it, at the host's size. */
export interface ExtensionScene {
  /** The augment or contribution id, as its registry holds it. */
  id: string;
  widgetId: string;
  /** Repo-relative fixture path. */
  fixture: string;
  w: number;
  h: number;
}

const COMPONENTS = "packages/components/src";
const PROBE = "packages/components/scripts/probe";

export const EXTENSION_SCENES: readonly ExtensionScene[] = [
  {
    id: "fleet-comms-actions",
    widgetId: "system-view",
    fixture: `${COMPONENTS}/SystemView/__fixtures__/kerbin-orbit-comms-active.json`,
    w: 10,
    h: 12,
  },
  {
    id: "fleet-reliability-updates",
    widgetId: "fleet-roster",
    fixture: `${COMPONENTS}/FleetReliability/__fixtures__/broken-reaction-wheel.json`,
    w: 8,
    h: 10,
  },
  {
    id: "objectives-contracts",
    widgetId: "objectives",
    fixture: `${COMPONENTS}/Objectives/__fixtures__/contracts-only.json`,
    w: 5,
    h: 8,
  },
  {
    id: "core:comm-signal-no-signal-badge",
    widgetId: "comm-signal",
    fixture: `${COMPONENTS}/CommSignal/__fixtures__/no-signal-occluded.json`,
    w: 8,
    h: 8,
  },
  {
    id: "core:crew-status-aboard-badge",
    widgetId: "crew-status",
    fixture: `${COMPONENTS}/CrewStatus/__fixtures__/valentina-solo-orbit.json`,
    w: 9,
    h: 10,
  },
  {
    id: "core:fleet-comms-badge",
    widgetId: "system-view",
    fixture: `${COMPONENTS}/SystemView/__fixtures__/kerbin-orbit-comms-active.json`,
    w: 14,
    h: 10,
  },
  {
    id: "core:descent-envelope",
    widgetId: "landing-status",
    fixture: `${COMPONENTS}/LandingStatus/__render__/descent-ignition.json`,
    w: 12,
    h: 16,
  },
  {
    id: "core:cross-section",
    widgetId: "landing-status",
    fixture: `${COMPONENTS}/LandingStatus/__render__/descent-ignition.json`,
    w: 12,
    h: 16,
  },
  {
    id: "core:touchdown-reticle",
    widgetId: "landing-status",
    fixture: `${COMPONENTS}/LandingStatus/__render__/descent-final.json`,
    w: 12,
    h: 16,
  },
  {
    id: "core:ship-map-part-meters",
    widgetId: "ship-map",
    fixture: `${COMPONENTS}/ShipMap/__fixtures__/probe/01-builtin-drainable-meters.json`,
    w: 8,
    h: 10,
  },
  {
    id: "core:space-center-status-facilities",
    widgetId: "space-center-status",
    fixture: `${COMPONENTS}/SpaceCenterStatus/__fixtures__/mid-career-mixed.json`,
    w: 9,
    h: 10,
  },
  {
    id: "core:system-view-stock-projections",
    widgetId: "system-view",
    fixture: `${COMPONENTS}/SystemView/__fixtures__/kerbin-orbit-inclined.json`,
    w: 10,
    h: 12,
  },
  {
    id: "core:system-view-vessel-orbits",
    widgetId: "system-view",
    fixture: `${COMPONENTS}/SystemView/__fixtures__/kerbin-orbit-inclined.json`,
    w: 10,
    h: 12,
  },
  {
    id: "core:system-view-vessel-silence-status",
    widgetId: "system-view",
    fixture: `${COMPONENTS}/SystemView/__fixtures__/kerbin-orbit-contact-lost.json`,
    w: 10,
    h: 12,
  },
  {
    id: "planted:ship-map-part-meters",
    widgetId: "ship-map",
    fixture: `${COMPONENTS}/ShipMap/__fixtures__/probe/02-two-contributors.json`,
    w: 8,
    h: 10,
  },
  {
    id: "planted:crew-status-meters",
    widgetId: "crew-status",
    fixture: `${PROBE}/planted-crew.json`,
    w: 9,
    h: 10,
  },
  {
    id: "planted:crew-status-row-tone",
    widgetId: "crew-status",
    fixture: `${PROBE}/planted-crew.json`,
    w: 9,
    h: 10,
  },
  {
    id: "planted:crew-status-badge",
    widgetId: "crew-status",
    fixture: `${PROBE}/planted-crew.json`,
    w: 9,
    h: 10,
  },
];

/**
 * A scene the harness renders through a dedicated probe rather than a render
 * config, added to its widget's own story file.
 */
export interface ExtraScene {
  widgetId: string;
  /** Repo-relative fixture path. */
  fixture: string;
  w: number;
  h: number;
}

export const EXTRA_SCENES: readonly ExtraScene[] = [
  // The crew-status badge and avatar probes' scene: every crew extension on.
  {
    widgetId: "crew-status",
    fixture: `${PROBE}/planted-crew.json`,
    w: 9,
    h: 10,
  },
];
