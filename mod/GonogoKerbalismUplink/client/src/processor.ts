import type { ResourceAmount, Value } from "@ksp-gonogo/sitrep-sdk";
import { observedAt, value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOr } from "@ksp-gonogo/ui-kit";
import type {
  KerbalismLifeSupport,
  KerbalismProfile,
} from "./__generated__/contract";
import { type Summary, summarise } from "./ecosystem";
import { KERBALISM } from "./uplink";

// The single per-frame derivation the Ship Systems widget AND its panel badge
// both pull from, and the Processor primitive's
// first real Uplink consumer. `summarise` runs ONCE against the four
// Kerbalism/vessel payloads per Sitrep frame no matter how many surfaces read
// it: the widget via `useProcessor`, the badge via a contribution `deps` on the
// handle this module exports. Before this, the widget re-derived on its own and
// a badge would have derived a second time.
//
// The result also carries the raw inputs the widget re-uses to build a
// per-resource ledger on demand: `buildLedger` is per-resource (one resource
// per call), so it stays a click-time call when a row is expanded, not part of
// this frame model.
// ---------------------------------------------------------------------------

export interface ShipSystems {
  /** Row model + root-cause ordering, the whole widget body renders from this. */
  summary: Summary;
  /** Carried so the widget can `buildLedger` for an expanded row without a re-subscribe. */
  profile: KerbalismProfile | undefined;
  lifeSupport: KerbalismLifeSupport | undefined;
  crew: number;
  /**
   * How current the RESOURCE LEVELS this summary was derived from actually are.
   *
   * Its own provenance rather than a nested `Reading`, for the reason the dep
   * form's doc gives: a `Reading` is one Topic's currency, and a summary that
   * reasons across resources is not one Topic's anything.
   *
   * It exists because every figure in `summary` is a function of the levels,
   * and a time-to-empty derived from levels observed twenty minutes ago is not
   * a time-to-empty. Before this the derivation read `point.payload` and could
   * not tell, so the widget presented a last-contact projection as current with
   * nothing anywhere saying so.
   */
  levels: LevelsProvenance;
}

/** Where the resource levels behind a summary came from, and when. */
export interface LevelsProvenance {
  /** The reading arm the levels arrived on. */
  state: "pending" | "absent" | "observed" | "stale" | "reckonable";
  /** UT the levels were observed at; undefined when nothing has been observed. */
  asOfUt: Value<"ut"> | undefined;
  /** Seconds between that observation and the frame this was derived for. */
  ageSec: number | undefined;
}

/**
 * `kerbalism:ship-systems`. The owner-stamped Processor handle. Import it to
 * consume the derivation, never re-declare it: a second registration under the
 * same id with a different compute throws (processors.ts).
 */
export const SHIP_SYSTEMS = KERBALISM.registerProcessor({
  id: "ship-systems",
  deps: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    // A READING, not the payload. Every figure this derivation produces is a
    // function of the resource levels, so whether those levels are current is
    // part of the answer rather than a detail a consumer can look up
    // separately. It also carries the observation's own UT, which is what
    // makes the age below honest.
    { reading: "vessel.resources" },
    "vessel.crew",
  ] as const,
  compute: (
    [profile, lifeSupport, resourcesReading, crew],
    frame,
  ): ShipSystems => {
    // `stored`/`capacity` were never Kerbalism-specific: they come off the
    // generic `vessel.resources` levels, keyed by KSP resource name.
    //
    // The LAST OBSERVED levels on every arm that has a value, never a modelled
    // figure: this derivation does not forward-model, it reports what it was
    // working from and how old that is, and `levels` below is what says so.
    const resources =
      resourcesReading.state === "observed" ||
      resourcesReading.state === "stale" ||
      resourcesReading.state === "reckonable"
        ? resourcesReading.value
        : undefined;
    // `observedAt` rather than the five-arm switch that used to be written out
    // here: the SDK carries it now, and one copy cannot disagree with itself.
    const observedAtUt = observedAt(resourcesReading);
    const stored: Record<string, number> = {};
    const capacity: Record<string, number> = {};
    const levels: Record<string, ResourceAmount> = resources?.resources ?? {};
    for (const [name, amount] of Object.entries(levels)) {
      stored[name] = magnitudeOr(amount.current, 0);
      capacity[name] = magnitudeOr(amount.max, 0);
    }
    const crewCount = magnitudeOr(crew?.count, 0);
    return {
      summary: summarise({
        profile,
        lifeSupport,
        stored,
        capacity,
        crew: crewCount,
      }),
      profile,
      lifeSupport,
      crew: crewCount,
      levels: {
        state: resourcesReading.state,
        asOfUt: observedAtUt,
        // Never negative: a sample can sit marginally ahead of the frame's view
        // time, and a negative age is not a thing to render.
        // An instant minus an instant is a duration, and the affine rules make
        // that the type; `.magnitude` because this field is declared in seconds.
        // Still clamped: a sample can sit marginally ahead of the frame's view
        // time, and a negative age is not a thing to render.
        ageSec:
          observedAtUt === undefined
            ? undefined
            : Math.max(
                0,
                value("ut", frame.viewUt).minus(observedAtUt).magnitude,
              ),
      },
    };
  },
});
