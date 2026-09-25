import type {
  Reading,
  ReckoningBasis,
  TopicReading,
  Value,
  VesselCrew,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, magnitudeOr } from "@ksp-gonogo/ui-kit";
import type {
  KerbalismCrewEntry,
  KerbalismCrewRule,
} from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// Per-kerbal Kerbalism survival: dose/stress/etc rule state plus a death
// clock, derived once per frame off the vessel's real crew roster
// (`vessel.crew`, the same identity source CrewStatus itself renders) joined
// against Kerbalism's own per-kerbal rule accumulators (`kerbalism.crew`).
//
// It belongs HERE, in the Kerbalism Uplink's own Processor, and not inline in
// CrewStatus (`packages/components`), which would contaminate the vanilla base
// widget with a Kerbalism-specific read. Consumed by the
// `crew-status.meters` contribution (meters.ts),
// the per-row badge augment (index.tsx)
// and the panel badge (badge.ts): one per-frame derivation, two consumers,
// same dogfood pattern as `SHIP_SYSTEMS`/`ship-systems-badge`.
//
// Joins by NAME: it is the only identity both `vessel.crew.crew[]`
// (`CrewMember`) and `kerbalism.crew[]` (`KerbalismCrewEntry`) carry in
// common. A kerbal absent from `kerbalism.crew` (no Kerbalism data reported
// for them yet, or the mod not installed) still gets a roster entry here
// with no rules, so a consumer can render "stable" rather than nothing.
//
// Deliberately does NOT derive the shared "time to life-support depletion"
// cross-resource clock from
// `kerbalism.lifesupport`/`kerbalism.profile`/`vessel.resources`: that is Ship
// Systems' own domain (`summarise`/`timeToEmptySeconds` in `../ecosystem`), and
// deriving it here too would be a second derivation of the same fact.
// `deathClockSec` below is read straight off the wire's own
// `KerbalismCrewEntry.deathClockSec`, which the mod fills in: it is the
// soonest FATAL rule, and only the mod can compute it because its first stage
// needs resource amounts that no per-craft channel carries. Null still means
// not derivable and must keep rendering differently from a long deadline.
// ---------------------------------------------------------------------------

/** One rule's current 0..1-toward-fatal fraction. */
export interface KerbalRuleState {
  /** Rule name straight off the wire, e.g. "radiation", "stress"; never a fixed allowlist. */
  name: string;
  fraction: number;
  /** Whether a model carried this accumulator forward rather than the reading giving it. */
  carried?: boolean;
}

export type SurvivalTone = "go" | "warn" | "nogo";

export interface KerbalSurvival {
  name: string;
  trait: string | null | undefined;
  /**
   * Every rule Kerbalism reports for this kerbal, worst (closest to fatal)
   * first. Empty when Kerbalism reports no rules for this kerbal.
   */
  rules: KerbalRuleState[];
  /** `rules[0]`; undefined when Kerbalism reports no rules for this kerbal.
   *  Kept alongside `rules` since the death-clock badge only ever needs the
   *  worst one, not the full list. */
  worstRule: KerbalRuleState | undefined;
  /**
   * Seconds until this kerbal dies, measured from the FRAME's view time.
   *
   * The wire carries `deathClockUt`, the instant itself, so this is a
   * subtraction the processor does once with the frame's own clock rather than
   * a duration each consumer re-anchors (or forgets to). Carrying the remaining
   * SECONDS on the wire instead would be true only measured from the payload's
   * `asOfUt`, and read as current wherever anyone rendered it raw.
   * Null while not resolved, and null is never a large number: a kerbal whose
   * deadline cannot be computed and one with years of supplies must not render
   * the same.
   */
  deathClockSec: number | null;
  tone: SurvivalTone;
}

export interface CrewSurvival {
  kerbals: KerbalSurvival[];
  /** Soonest reported death clock across the crew, or null when none is reported. */
  soonestDeathClockSec: number | null;
  /**
   * The model that carried the survival accumulators forward, when the crew
   * reading had stopped arriving and a model answered for it. Absent when the
   * figures are the reading itself, current or held.
   *
   * It covers the accumulators only. A death clock is Kerbalism's own instant,
   * derived at its last turn and never moved by a model here, so it stays the
   * held deadline even inside a carried answer.
   */
  basis?: ReckoningBasis;
}

/**
 * Below this many seconds to a reported death, a kerbal reads critical
 * regardless of their worst rule's fraction: mirrors Ship Systems'
 * `SOON_EMPTY_SEC` reasoning (10 minutes: long enough not to fire on a
 * warp-time transient, short enough to act on).
 */
const SOON_DEATH_SEC = 600;

/**
 * Where a rule's fraction toward fatal becomes critical. The one definition of
 * danger in this widget: the tones, the header badge and the band badge all
 * read it, so no two of them can disagree about when a kerbal is in trouble.
 */
export const CRITICAL_FRACTION = 0.8;

/** Tone for a single rule's own fraction, independent of the kerbal's
 *  overall tone (which a death clock can force to `nogo` even when every
 *  individual rule reads calm). Exported so the per-rule meters in the
 *  `.survival` augment (index.tsx) can colour each rule by its own reading. */
export function toneFor(fraction: number): SurvivalTone {
  if (fraction >= CRITICAL_FRACTION) return "nogo";
  if (fraction >= 0.5) return "warn";
  return "go";
}

function kerbalTone(
  worstFraction: number,
  deathClockSec: number | null,
): SurvivalTone {
  if (deathClockSec !== null && deathClockSec < SOON_DEATH_SEC) return "nogo";
  return toneFor(worstFraction);
}

/**
 * One accumulator's place on the 0..1 toward-fatal axis.
 *
 * Exported because the axis is shared rather than private: `./ruleReadings`
 * moves the crew model's uncertainty interval onto the same axis end by end,
 * and an interval divided by one number while the figure it bounds was divided
 * by another is an interval about nothing.
 *
 * In the algebra rather than on two bare numbers, so the division is
 * dimension-checked and the result says what it is. Both halves must be known
 * finite before it runs: the clamp answers a non-finite accumulator with 0,
 * which on this axis is the reading that says the crew is fine.
 */
export function onFatalAxis(
  accumulated: Value<"units">,
  threshold: Value<"units">,
): Value<"ratio"> {
  return accumulated.dividedBy(threshold).in("ratio").max(0).min(1);
}

/**
 * Normalize one wire rule's raw accumulator to a 0..1-toward-fatal fraction.
 * Kerbalism's default profile uses `fatal_threshold=1.0` for most rules but
 * overrides it per-rule (radiation's is 50), dividing by the rule's OWN
 * `fatalThreshold` rather than assuming it's always 1 keeps every rule
 * comparable on the same 0..1 scale (ported unchanged from CrewStatus's
 * old `ruleFraction`, moved here with the rest of the Kerbalism-specific
 * logic it contaminated the base widget with).
 *
 * Exported for `./ruleReadings`, which needs the same figure keyed by the
 * WIRE's own rule position rather than by this derivation's sorted one.
 */
export function ruleFraction(rule: KerbalismCrewRule): number | null {
  // Null rather than 0 on either half. A rule whose accumulator or whose
  // fatal threshold never arrived has no position on the toward-fatal scale,
  // and 0 on that scale is the reading that says the crew is fine.
  const accumulated = rule.problem;
  const threshold = rule.fatalThreshold;
  // `== null`: both are `double?` on the contract and the wire keeps the key,
  // so "never arrived" reaches here as an explicit null rather than as absence.
  // The strict form let it past into the arithmetic below.
  if (accumulated == null || threshold == null) return null;
  if (magnitudeOf(accumulated) === null) return null;
  const limit = magnitudeOr(threshold, Number.NaN);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return magnitudeOf(onFatalAxis(accumulated, threshold));
}

/**
 * Every rule Kerbalism reports for this kerbal, regardless of name. A fixed
 * allowlist silently drops any rule outside it (a custom rule under RO's
 * profile, say), so this reads whatever the loaded profile actually defines,
 * the same "never name a
 * resource/rule the profile didn't declare" discipline `../ecosystem` uses
 * for resources.
 */
function toKerbalSurvival(
  name: string,
  trait: string | null | undefined,
  entry: KerbalismCrewEntry | undefined,
  viewUt: number,
  carried: ReadonlySet<string>,
): KerbalSurvival {
  const rules: KerbalRuleState[] = [];
  for (const rule of entry?.rules ?? []) {
    if (!rule.name) continue;
    // A rule with nothing to place on the scale is not carried: a meter or a
    // tone derived from it would be a claim about a kerbal nobody measured.
    const fraction = ruleFraction(rule);
    if (fraction === null) continue;
    rules.push(
      carried.has(ruleKey(name, rule.name))
        ? { name: rule.name, fraction, carried: true }
        : { name: rule.name, fraction },
    );
  }
  // Worst (closest to fatal) first: the `.survival` augment shows the most
  // alarming rule first when it has to collapse the rest behind a disclosure.
  rules.sort((a, b) => b.fraction - a.fraction);
  const worstRule = rules[0];
  // An INSTANT on the wire, so the remaining time is it minus the frame's view
  // time. Clamped at zero: a deadline already behind us is "now", never a
  // negative countdown.
  const deathClockUt = magnitudeOr(entry?.deathClockUt, Number.NaN);
  const deathClockSec = Number.isFinite(deathClockUt)
    ? Math.max(0, deathClockUt - viewUt)
    : null;
  return {
    name,
    trait,
    rules,
    worstRule,
    deathClockSec,
    tone: kerbalTone(worstRule?.fraction ?? 0, deathClockSec),
  };
}

/**
 * The whole derivation, pure: joins the vessel's real crew roster against
 * Kerbalism's per-kerbal rule accumulators. Exported so a test can exercise
 * it directly (mirrors `../ecosystem`'s exported `summarise`) without
 * needing a live Processor evaluator; `CREW_SURVIVAL.compute` below is a
 * thin wire-up over this.
 */
export function deriveCrewSurvival(
  crew: VesselCrew | undefined,
  kerbals: KerbalismCrewEntry[] | undefined,
  viewUt: number,
  carried: ReadonlySet<string> = new Set(),
): CrewSurvival {
  const byName = new Map<string, KerbalismCrewEntry>();
  for (const entry of kerbals ?? []) {
    if (entry.name) byName.set(entry.name, entry);
  }
  const kerbalsOut = (crew?.crew ?? []).map((member) => {
    const name = member.name ?? "Unknown";
    return toKerbalSurvival(
      name,
      member.trait,
      byName.get(name),
      viewUt,
      carried,
    );
  });
  const clocks = kerbalsOut
    .map((k) => k.deathClockSec)
    .filter((s): s is number => s !== null);
  return {
    kerbals: kerbalsOut,
    soonestDeathClockSec: clocks.length > 0 ? Math.min(...clocks) : null,
  };
}

/**
 * `kerbalism:crew-survival`. The owner-stamped Processor handle. Import it
 * to consume the derivation, never re-declare it.
 *
 * `kerbalism.crew` is taken as a READING, so the derivation answers with its
 * currency and a display can say when a death clock is a held one. Every
 * figure here comes off that one Topic; `vessel.crew` supplies only names and
 * order, so its currency is not the answer's and it stays a bare dep.
 */
export const CREW_SURVIVAL = KERBALISM.registerProcessor({
  id: "crew-survival",
  deps: ["vessel.crew", { reading: "kerbalism.crew" }] as const,
  // Explicitly typed (rather than relying on inference through the sdk
  // facade's intentionally loose `compute: (values: any) => R` leaf
  // signature, see registerProcessor's own doc comment): an `any`-typed
  // receiver does not contextually type a chained `.map()`/`.filter()`
  // callback's own parameters, which trips `noImplicitAny` on every one of
  // them the moment more than plain property access is needed.
  compute: (
    [crew, kerbals]: readonly [
      VesselCrew | undefined,
      TopicReading<KerbalismCrewEntry[]>,
    ],
    // The frame's frozen view time, which is what turns the wire's death-clock
    // INSTANT into a remaining duration. Reaching for a wall clock here would
    // let two readouts in one frame disagree about the same deadline.
    frame: { viewUt: number },
  ): CrewSurvival => {
    /*
     * A reading that has stopped arriving is carried forward where the crew
     * model answers: a worsening accumulator keeps worsening and an improving
     * one keeps improving, which a held figure cannot show. The held figure
     * stays reachable through the reading's own marks. A current reading is
     * drawn as it is, since the model has nothing to add to an observation.
     */
    if (kerbals.state === "stale" && kerbals.reckoning.status === "available") {
      const projected = kerbals.reckoning.value;
      return {
        ...deriveCrewSurvival(
          crew,
          projected,
          frame.viewUt,
          carriedRules(projected, kerbals.reckoning.modelled),
        ),
        basis: kerbals.reckoning.basis,
      };
    }
    return deriveCrewSurvival(
      crew,
      kerbals.state === "observed" || kerbals.state === "stale"
        ? kerbals.value
        : undefined,
      frame.viewUt,
    );
  },
});

/**
 * The survival figures a {@link CREW_SURVIVAL} answer carries, and how current
 * they are. `undefined` where there are none to draw.
 *
 * `stale` is true whenever the crew reading has stopped arriving; `basis` then
 * says whether a model carried the accumulators forward, and its absence that
 * they are the last reading, held. Neither is ever drawn without saying which.
 */
export function survivalFrom(reading: Reading<CrewSurvival> | undefined):
  | {
      survival: CrewSurvival;
      stale: boolean;
      basis: ReckoningBasis | undefined;
    }
  | undefined {
  if (reading?.state !== "observed" && reading?.state !== "stale") {
    return undefined;
  }
  const survival = reading.value;
  if (survival === undefined) return undefined;
  return {
    survival,
    stale: reading.state === "stale",
    basis: reading.state === "stale" ? survival.basis : undefined,
  };
}

/** One kerbal's rule, keyed by name on both halves, the way a crew roster is joined. */
function ruleKey(kerbal: string, rule: string): string {
  return `${kerbal}\0${rule}`;
}

/**
 * Which rules the crew model actually moved, off the paths its reckoning names
 * (`<kerbal>.rules.<rule>.problem`). A rule it did not name is copied verbatim
 * from the last reading, so a figure derived from it is held, not modelled.
 */
function carriedRules(
  projected: readonly KerbalismCrewEntry[],
  modelled: readonly { readonly path: string }[],
): ReadonlySet<string> {
  const carried = new Set<string>();
  for (const { path } of modelled) {
    const match = /^(\d+)\.rules\.(\d+)\.problem$/.exec(path);
    if (!match) continue;
    const entry = projected[Number(match[1])];
    const rule = entry?.rules?.[Number(match[2])];
    if (entry?.name && rule?.name) carried.add(ruleKey(entry.name, rule.name));
  }
  return carried;
}

/**
 * Why a kerbal reads critical, or `null` when they do not: the death clock
 * Kerbalism derived at its last turn, a rule a model carried past it, or a rule
 * as the reading gave it. A death clock is named first because it forces the
 * tone on its own, so a kerbal it covers is critical whatever a model says.
 */
export function criticalCause(
  kerbal: KerbalSurvival,
): "death-clock" | "carried-rule" | "rule" | null {
  if (kerbal.tone !== "nogo") return null;
  if (kerbal.deathClockSec !== null && kerbal.deathClockSec < SOON_DEATH_SEC) {
    return "death-clock";
  }
  return kerbal.worstRule?.carried ? "carried-rule" : "rule";
}
