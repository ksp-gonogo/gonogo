/** The context both LaunchDirector slots pass to their augments: the pre-launch selection the operator is about to commit. */
export interface LaunchDirectorSlotContext {
  /** Current KSP scene, undefined until telemetry arrives and while the mod cannot name it. */
  scene: string | undefined;
  /** True while a vessel is in flight (scene === "Flight"). */
  inFlight: boolean;
  /** The saved craft selected in the pre-launch picker, or null when none. */
  selectedShip: string | null;
  /** The chosen launch-site name (e.g. "LaunchPad"). */
  selectedSite: string;
  /** Crew names the operator has selected for the launch. */
  selectedCrew: string[];
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

/**
 * One pad, as the row that draws it sees it. An Uplink that models launch
 * complexes joins its own pad record on {@link siteName}. Per-row, so a pad an
 * Uplink knows is busy can say so from the row.
 */
export interface LaunchDirectorPadContext {
  /** The site's internal `LaunchSite.name`: the stable key an Uplink joins on. */
  siteName: string;
  /** The site's human-facing name, as the row shows it. */
  displayName: string;
  /** KSP's `EditorFacility` name for this site: a `VAB` site is a pad, an `SPH` site a runway. */
  editorFacility: string;
  /** Whether a vessel is standing on this pad; `null` when this site reports no occupancy. */
  occupied: boolean | null;
  /** The occupying vessel's name, `null` when none is reported. */
  occupantName: string | null;
  /** Whether this is the pad the operator has opened, so an augment can spend more room on it. */
  expanded: boolean;
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

// Declaration-merge the slot ids onto their props type in core's `SlotRegistry`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "launch-director.preflight": LaunchDirectorSlotContext;
    "launch-director.pad": LaunchDirectorPadContext;
  }
}
