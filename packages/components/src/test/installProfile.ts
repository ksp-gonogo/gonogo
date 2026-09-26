import { HEALTH_STATE_NAMES } from "@ksp-gonogo/sitrep-sdk/spine";
import reliabilityUnavailable from "./__profiles__/reliability-unavailable.json";
import rp1KerbalismLive from "./__profiles__/rp1-kerbalism-live.json";
import rp1NoTestflight from "./__profiles__/rp1-no-testflight.json";
import rp1Testflight from "./__profiles__/rp1-testflight.json";
import stockCareer from "./__profiles__/stock-career.json";
import testflightUnreadable from "./__profiles__/testflight-unreadable.json";

/**
 * A named, checked-in install: which Gonogo Uplinks a machine has, which
 * capability provider won each election, and what that combination puts on
 * the wire. A fixture says what one vessel is doing; a profile says what world
 * it is doing it in.
 *
 * Everything a widget can observe about an install is wire state, in three
 * shapes, so a profile is pure data:
 *
 * 1. the `system.uplinks` roster, which `useUplinkHealthFor` resolves a
 *    widget's required channels against and `RequiresGuard` blocks on
 * 2. a `<domain>.available` topic, whose presence gates augment slots
 * 3. a payload field naming the elected provider, where the contract has one
 *
 * {@link InstallProfile.elections} is a claim, not a check: election reaches
 * the wire only where a contract field carries it. A profile does not decide
 * which Uplink client bundles are loaded.
 */
export interface InstallProfile {
  /** Stable id, matching the file name under `__profiles__/`. */
  id: string;
  name: string;
  /** What install this is, in the operator's terms. */
  description: string;
  /**
   * The `system.uplinks` roster, partial by design. A channel owned by nobody
   * in it resolves `unowned` and passes every gate, as the real mod does.
   */
  uplinks: InstallProfileUplink[];
  /** Capability id to the provider id that won it. Documentation only. */
  elections: Record<string, string>;
  /** Topic payloads this install puts on the wire, layered over the base fixture's own. */
  wire: Record<string, unknown>;
  /**
   * Topics this install does not carry at all: an Uplink whose DLL is not
   * installed, which differs from one installed and reporting unavailable.
   */
  absentChannels?: string[];
}

/** One roster entry, in the profile's authoring form. */
export interface InstallProfileUplink {
  /** Matches the mod's `[SitrepUplink("<id>")]`. */
  id: string;
  version?: string;
  /** Whether the Uplink found what it wraps. False is installed, but the mod it needs is not here. */
  available: boolean;
  reason?: string | null;
  /** Every topic or `.`-terminated namespace this Uplink owns (the mod's `ComputeOwnedPrefixes`). */
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
  /** The profiles this scene is interesting under, by id, declared by the scene so the matrix never becomes every widget times every install. */
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
  // States no other profile reaches: a modelling Kerbalism backend, TestFlight part conditions that cannot be read, and a provider whose factory threw.
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
 * produce, as a fresh block. `system.uplinks` is emitted first so the roster
 * lands before any widget resolves against it; a topic in `wire` replaces the
 * base emit outright, and one in `absentChannels` leaves the wire entirely.
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
