import type { ReadoutTone } from "@ksp-gonogo/ui-kit";

// `crew-status.row-badges`: per-row inline badges keyed by `crewName`, with `crewIndex` disambiguating shared names. Not `.badges`, which is the framework's own contribution slot.

/** Props passed to every `crew-status.row-badges` augment, one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.row-badges": CrewBadgeContext;
  }
}

// `crew-status.avatar`: a per-row leading avatar cell keyed like `.row-badges`, reserved only while an Uplink binds it and blank for a kerbal it has nothing for.

/** Props passed to every `crew-status.avatar` augment, one per crew row. */
export interface CrewAvatarContext {
  /** The crew member this avatar belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.avatar": CrewAvatarContext;
  }
}

// Per-row survival meters are the framework's `crew-status.meters` contribution segment, addressed to a kerbal by `row`.

/*
 * `crew-status.row-tone`: data rather than JSX, because the tinted `Card` wraps the whole row and no augment can reach it.
 * A contributor names a severity; the host owns the palette. First entry per name wins.
 */

/** One entry of a `crew-status.row-tone` contribution: how alarming this
 *  kerbal's situation is, or omit the kerbal entirely for "nothing to
 *  report". */
export interface CrewRowToneEntry {
  /** The crew member this entry is about; matched against the roster row by name. */
  crewName: string;
  /** How alarming the situation is. The host decides what that looks like. */
  severity: "info" | "warning" | "critical";
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "crew-status.row-tone": {
      entry: CrewRowToneEntry;
      topics: "vessel.crew";
    };
  }
}

/** The host's palette decision, and the only one: a contributor's severity becomes the `Card` tone here and nowhere else. */
export const ROW_TONE_BY_SEVERITY: Record<
  CrewRowToneEntry["severity"],
  ReadoutTone
> = {
  info: "default",
  warning: "warning",
  critical: "alert",
};

// `crew-status.summary`: one whole-widget section above the roster for crew-wide status, with no per-kerbal props.

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.summary": Record<string, never>;
  }
}
