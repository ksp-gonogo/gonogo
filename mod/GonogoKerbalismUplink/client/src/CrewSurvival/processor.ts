import type {
  KerbalismCrewEntry,
  KerbalismCrewRule,
  VesselCrew,
} from "@ksp-gonogo/sitrep-sdk";
import { mag } from "../ecosystem";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// Per-kerbal Kerbalism survival: dose/stress/etc rule state plus a death
// clock, derived once per frame off the vessel's real crew roster
// (`vessel.crew`, the same identity source CrewManifest itself renders) joined
// against Kerbalism's own per-kerbal rule accumulators (`kerbalism.crew`).
//
// This is the derivation that used to live INLINE in CrewManifest
// (`packages/components`), contaminating the vanilla base widget with a
// Kerbalism-specific read. It now lives here, the Kerbalism Uplink's own
// Processor, consumed by the `crew-manifest.survival` augment (index.tsx)
// and the panel badge (badge.ts): one per-frame derivation, two consumers,
// same dogfood pattern as `SHIP_SYSTEMS`/`ship-systems-badge`.
//
// Joins by NAME: it is the only identity both `vessel.crew.crew[]`
// (`CrewMember`) and `kerbalism.crew[]` (`KerbalismCrewEntry`) carry in
// common. A kerbal absent from `kerbalism.crew` (no Kerbalism data reported
// for them yet, or the mod not installed) still gets a roster entry here
// with no rules, so a consumer can render "stable" rather than nothing.
//
// Deliberately does NOT re-derive the shared "time to life-support
// depletion" cross-resource clock the old inline code computed from
// `kerbalism.lifesupport`/`kerbalism.profile`/`vessel.resources`: that is
// Ship Systems' own domain now (`summarise`/`timeToEmptySeconds` in
// `../ecosystem`), and duplicating it here would be a second derivation of
// the same fact. `deathClockSec` below is read straight off the wire's own
// `KerbalismCrewEntry.deathClockSec` (currently always `null`, the mod does
// not yet resolve a rule's linked resource; see that field's own contract
// doc), leaving room for the mod to fill it in later with zero client change.
// ---------------------------------------------------------------------------

/** One rule's current 0..1-toward-fatal fraction. */
export interface KerbalRuleState {
  /** Rule name straight off the wire, e.g. "radiation", "stress"; never a fixed allowlist. */
  name: string;
  fraction: number;
}

export type SurvivalTone = "go" | "warn" | "nogo";

export interface KerbalSurvival {
  name: string;
  trait: string | undefined;
  /** The rule closest to fatal; undefined when Kerbalism reports no rules for this kerbal. */
  worstRule: KerbalRuleState | undefined;
  /** Seconds until this kerbal dies, straight off the wire; null while not resolved. */
  deathClockSec: number | null;
  tone: SurvivalTone;
}

export interface CrewSurvival {
  kerbals: KerbalSurvival[];
  /** Soonest reported death clock across the crew, or null when none is reported. */
  soonestDeathClockSec: number | null;
}

/**
 * Below this many seconds to a reported death, a kerbal reads critical
 * regardless of their worst rule's fraction: mirrors Ship Systems'
 * `SOON_EMPTY_SEC` reasoning (10 minutes: long enough not to fire on a
 * warp-time transient, short enough to act on).
 */
const SOON_DEATH_SEC = 600;

function toneFor(fraction: number): SurvivalTone {
  if (fraction >= 0.8) return "nogo";
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
 * Normalize one wire rule's raw accumulator to a 0..1-toward-fatal fraction.
 * Kerbalism's default profile uses `fatal_threshold=1.0` for most rules but
 * overrides it per-rule (radiation's is 50), dividing by the rule's OWN
 * `fatalThreshold` rather than assuming it's always 1 keeps every rule
 * comparable on the same 0..1 scale (ported unchanged from CrewManifest's
 * old `ruleFraction`, moved here with the rest of the Kerbalism-specific
 * logic it contaminated the base widget with).
 */
function ruleFraction(rule: KerbalismCrewRule): number {
  const accumulated = mag(rule.value, 0);
  const threshold = mag(rule.fatalThreshold, Number.NaN);
  if (!Number.isFinite(threshold) || threshold <= 0) return 0;
  return Math.min(1, Math.max(0, accumulated / threshold));
}

/**
 * Every rule Kerbalism reports for this kerbal, regardless of name: unlike
 * the old base-widget code (a fixed 7-name allowlist that silently dropped
 * any rule outside it, e.g. a custom rule under RO's profile), this reads
 * whatever the loaded profile actually defines, the same "never name a
 * resource/rule the profile didn't declare" discipline `../ecosystem` uses
 * for resources.
 */
function toKerbalSurvival(
  name: string,
  trait: string | undefined,
  entry: KerbalismCrewEntry | undefined,
): KerbalSurvival {
  let worstRule: KerbalRuleState | undefined;
  for (const rule of entry?.rules ?? []) {
    if (!rule.name) continue;
    const fraction = ruleFraction(rule);
    if (!worstRule || fraction > worstRule.fraction) {
      worstRule = { name: rule.name, fraction };
    }
  }
  const rawDeathClock = mag(entry?.deathClockSec, Number.NaN);
  const deathClockSec = Number.isFinite(rawDeathClock) ? rawDeathClock : null;
  return {
    name,
    trait,
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
): CrewSurvival {
  const byName = new Map<string, KerbalismCrewEntry>();
  for (const entry of kerbals ?? []) {
    if (entry.name) byName.set(entry.name, entry);
  }
  const kerbalsOut = (crew?.crew ?? []).map((member) => {
    const name = member.name ?? "Unknown";
    return toKerbalSurvival(name, member.trait, byName.get(name));
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
 */
export const CREW_SURVIVAL = KERBALISM.registerProcessor({
  id: "crew-survival",
  deps: ["vessel.crew", "kerbalism.crew"] as const,
  // Explicitly typed (rather than relying on inference through the sdk
  // facade's intentionally loose `compute: (values: any) => R` leaf
  // signature, see registerProcessor's own doc comment): an `any`-typed
  // receiver does not contextually type a chained `.map()`/`.filter()`
  // callback's own parameters, which trips `noImplicitAny` on every one of
  // them the moment more than plain property access is needed.
  compute: ([crew, kerbals]: readonly [
    VesselCrew | undefined,
    KerbalismCrewEntry[] | undefined,
  ]): CrewSurvival => deriveCrewSurvival(crew, kerbals),
});
