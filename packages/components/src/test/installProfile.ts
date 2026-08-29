import { HEALTH_STATE_NAMES } from "@ksp-gonogo/sitrep-sdk/spine";
import reliabilityUnavailable from "./__profiles__/reliability-unavailable.json";
import rp1KerbalismLive from "./__profiles__/rp1-kerbalism-live.json";
import rp1NoTestflight from "./__profiles__/rp1-no-testflight.json";
import rp1Testflight from "./__profiles__/rp1-testflight.json";
import stockCareer from "./__profiles__/stock-career.json";
import testflightUnreadable from "./__profiles__/testflight-unreadable.json";

/**
 * A named, checked-in INSTALL: which Gonogo Uplinks a machine has, which
 * capability provider won each election, and what that combination puts on the
 * wire. A fixture says what one vessel is doing; a profile says what world it is
 * doing it in.
 *
 * ## Why a profile is data
 *
 * Everything a widget can observe about an install arrives as wire state, and
 * there are exactly three shapes of it:
 *
 * 1. the `system.uplinks` roster, which the mod's ChannelEngine builds because
 *    it is the only component that sees every registered Uplink at once. This
 *    is what `useUplinkHealthFor` resolves a widget's required channels against,
 *    and what `RequiresGuard` blocks on
 * 2. a `<domain>.available` topic, whose mere presence is what ui-kit's
 *    domain-availability store gates augment slots on
 * 3. a payload field that names the elected provider, where the contract chose
 *    to expose one
 *
 * So a profile needs no linking and no swapped implementations: it is a roster,
 * an election table and a set of topic payloads.
 *
 * ## The election table is a claim, not a check
 *
 * {@link InstallProfile.elections} records which provider won each capability.
 * Nothing verifies it, because nothing CAN: the kernel's resolution notices stay
 * mod-side and never reach the wire. Election reaches a client only where a
 * contract field carries it (`reliability.summary.source` is the one that does),
 * and everywhere else it is visible solely as different values on the same
 * channel. The table is therefore the profile author's statement of why the wire
 * below looks the way it does, and is worth writing down for exactly that
 * reason.
 *
 * ## What a profile deliberately does not decide
 *
 * Which Uplink CLIENT bundles are loaded. The probe entry imports a fixed three,
 * the app static-imports seven and runtime-loads the rest off the roster. A
 * profile governs one widget's data world, not the component registry.
 */
export interface InstallProfile {
  /** Stable id, matching the file name under `__profiles__/`. */
  id: string;
  name: string;
  /** What install this is, in the operator's terms. */
  description: string;
  /**
   * The `system.uplinks` roster this install reports. Partial by design: list
   * the Uplinks the profile is ABOUT. A channel owned by nobody in this roster
   * resolves `unowned` and passes every gate through, which is what a real mod
   * does for a topic no registered Uplink claims.
   */
  uplinks: InstallProfileUplink[];
  /** Capability id to the provider id that won it. Documentation; see the module doc. */
  elections: Record<string, string>;
  /** Topic payloads this install puts on the wire, layered over the base fixture's own. */
  wire: Record<string, unknown>;
  /**
   * Topics this install does not carry at all, dropped from both the carried
   * allowlist and the emit list. An Uplink whose DLL is not installed takes its
   * channels off the wire entirely, which is a different state from one that is
   * installed and reporting unavailable.
   */
  absentChannels?: string[];
}

/** One roster entry, in the profile's authoring form. */
export interface InstallProfileUplink {
  /** Matches the mod's `[SitrepUplink("<id>")]`. */
  id: string;
  version?: string;
  /** Whether the Uplink found what it wraps. False is "installed but the mod it needs is not here". */
  available: boolean;
  reason?: string | null;
  /**
   * Every topic or `.`-terminated namespace this Uplink owns, the mod's own
   * `ComputeOwnedPrefixes` output. An Uplink that declares no channels owns
   * nothing, so no widget's required channels can ever resolve to it.
   */
  ownedPrefixes?: string[];
  state?: (typeof HEALTH_STATE_NAMES)[number];
  detail?: string | null;
}

/** The wire form of a fixture's stream declaration, matching a fixture's `_stream` block. */
export interface InstallProfileStreamBlock {
  carriedChannels: string[];
  pinnedUt?: number;
  delaySeconds?: number;
  emits: Array<{ channel: string; value: unknown; meta?: unknown }>;
  /**
   * The profiles this scene is interesting under, by id. Declared by the SCENE
   * so the matrix never becomes every widget times every install: a crew widget
   * cares about the crew-standing election and nothing else, and has no
   * business rendering under twelve worlds to prove it.
   */
  profiles?: string[];
}

/** The profiles a fixture declares itself interesting under, empty when it declares none. */
export function fixtureProfiles(fixture: {
  _stream?: { profiles?: string[] };
}): string[] {
  return fixture._stream?.profiles ?? [];
}

export const INSTALL_PROFILES: Record<string, InstallProfile> = Object.freeze({
  [(rp1Testflight as InstallProfile).id]: rp1Testflight as InstallProfile,
  [(rp1NoTestflight as InstallProfile).id]: rp1NoTestflight as InstallProfile,
  [(stockCareer as InstallProfile).id]: stockCareer as InstallProfile,
  // The three below exist because the matrix above could not REACH three states
  // the mod really produces: a Kerbalism backend that is modelling (the other
  // Kerbalism profile empties its part list, so its blank came from the data
  // rather than from any widget decision), a TestFlight backend whose part
  // conditions cannot be read (the state the shipped Uplink was permanently in),
  // and a provider whose factory threw. Each of those renders differently from
  // every other, and none of them could be rendered at all before.
  [(rp1KerbalismLive as InstallProfile).id]: rp1KerbalismLive as InstallProfile,
  [(testflightUnreadable as InstallProfile).id]:
    testflightUnreadable as InstallProfile,
  [(reliabilityUnavailable as InstallProfile).id]:
    reliabilityUnavailable as InstallProfile,
});

/** Looks a profile up by id, naming the ones that exist when it misses. */
export function getInstallProfile(id: string): InstallProfile {
  const profile = INSTALL_PROFILES[id];
  if (!profile) {
    throw new Error(
      `Unknown install profile "${id}". Known: ${Object.keys(INSTALL_PROFILES).sort().join(", ")}`,
    );
  }
  return profile;
}

/**
 * The `system.uplinks` payload this profile reports, in the mod's own wire
 * shape: health state as its integer ordinal, `facts` and `ownedPrefixes`
 * always present as arrays rather than absent.
 */
export function systemUplinksPayload(profile: InstallProfile): {
  uplinks: Array<Record<string, unknown>>;
} {
  return {
    uplinks: profile.uplinks.map((uplink) => {
      const state =
        uplink.state ?? (uplink.available ? "healthy" : "unavailable");
      const ordinal = HEALTH_STATE_NAMES.indexOf(state);
      if (ordinal < 0) {
        throw new Error(
          `Uplink "${uplink.id}" in profile "${profile.id}" declares health state "${state}", which is not a UplinkHealthState.`,
        );
      }
      return {
        id: uplink.id,
        version: uplink.version ?? "1.0.0",
        available: uplink.available,
        reason: uplink.reason ?? null,
        ownedPrefixes: uplink.ownedPrefixes ?? [],
        health: {
          state: ordinal,
          detail: uplink.detail ?? null,
          facts: [],
        },
      };
    }),
  };
}

/**
 * Rewrites a fixture's stream declaration into the one this install would
 * produce. Pure, and returns a fresh block: the base is never mutated, so one
 * fixture can be rendered under several profiles in a single test.
 *
 * `system.uplinks` is emitted FIRST so the health roster has landed before any
 * widget reads a channel that resolves against it. A topic the profile names in
 * `wire` replaces the base fixture's emit for that topic outright rather than
 * racing it, and a topic in `absentChannels` leaves the wire entirely.
 */
export function applyInstallProfile(
  profile: InstallProfile,
  base: InstallProfileStreamBlock,
): InstallProfileStreamBlock {
  const absent = new Set(profile.absentChannels ?? []);
  const overridden = new Set(Object.keys(profile.wire));

  const carried = ["system.uplinks"];
  for (const channel of base.carriedChannels) {
    if (absent.has(channel)) continue;
    if (carried.includes(channel)) continue;
    carried.push(channel);
  }
  for (const channel of overridden) {
    if (absent.has(channel)) continue;
    if (carried.includes(channel)) continue;
    carried.push(channel);
  }

  const emits: InstallProfileStreamBlock["emits"] = [
    { channel: "system.uplinks", value: systemUplinksPayload(profile) },
  ];
  for (const emit of base.emits) {
    if (absent.has(emit.channel) || overridden.has(emit.channel)) continue;
    emits.push(emit);
  }
  for (const [channel, value] of Object.entries(profile.wire)) {
    if (absent.has(channel)) continue;
    emits.push({ channel, value });
  }

  return {
    carriedChannels: carried,
    pinnedUt: base.pinnedUt,
    delaySeconds: base.delaySeconds,
    emits,
  };
}
