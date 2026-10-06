export type { AstronautComplexCrewContext } from "@ksp-gonogo/sitrep-sdk";

/**
 * The `astronaut-complex.crew-badge` slot: the top-right corner of a kerbal's
 * card, a mark read WITH the name while scanning, where the crew slot is a
 * block read once settled on a kerbal. Stock puts nothing here: it is for a
 * state an Uplink holds about a kerbal that KSP's roster does not. Same props
 * as the crew slot.
 */
export const ASTRONAUT_COMPLEX_CREW_BADGE_SLOT = "astronaut-complex.crew-badge";

/**
 * The `astronaut-complex.tab` slot: a whole TAB beside Applicants and Active,
 * absent until an Uplink claims it. Generic on purpose: stock has no concept
 * of what the tab is FOR, so nothing here names one. The augment that binds it
 * supplies its own `label` (`AugmentDefinition.label`), which becomes the
 * tab's label, and its own content, which becomes the tab's panel; the host
 * draws neither. Renamed from `astronaut-complex.training` (Saga 722/697): the
 * old id named a career-mod's crew-training concept, which stock does not
 * have, and is listed in ui-kit's `RETIRED_SLOT_IDS`.
 */
export const ASTRONAUT_COMPLEX_TAB_SLOT = "astronaut-complex.tab";

/**
 * The `astronaut-complex.readouts` contribution slot: further cells in the
 * core-stat strip. A contribution, not an augment, so the host draws every
 * cell with its own `Stat` and a contributed figure is indistinguishable from
 * a built-in one.
 */
export const ASTRONAUT_COMPLEX_READOUTS_SLOT = "astronaut-complex.readouts";

export const NO_SEGMENT_PROPS: Record<string, never> = Object.freeze({});
