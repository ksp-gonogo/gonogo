import type {
  CommandCentreEntry,
  CommsHop,
  SystemBodies,
  TrackingStationCatalog,
} from "../__generated__/contract";
import { CommsDelaySource } from "../__generated__/contract";
import type { Quantityish } from "../magnitude";
import { catalogRelayOrbit } from "./catalog-fallback";
import { deriveCelestialFacts } from "./celestial-facts";
import { commsDelaySecondsAt } from "./comms-delay-reckoning";
import { locateCommsPeer } from "./comms-path-geometry";

/**
 * How many seconds a signal takes per metre of route, as the mod measured it:
 * the one-way delay over the length of the route `comms.path` published, or
 * `null` when the pair gives no rate. Useful for carrying a measured light-speed
 * scale to a craft whose own delay has not arrived. Used by the alarm host to
 * estimate the delay to a craft just switched to.
 *
 * Recovering the rate from a measurement rather than dividing by the speed of
 * light is deliberate: the mod divides by the speed of light times a career
 * setting that is not on the wire, so only a measured delay over its measured
 * route says what was used. A delay that is a configured zero rather than a
 * light-time gives no rate.
 */
export function lightSecondsPerMetre(input: {
  readonly hops: readonly CommsHop[] | undefined;
  readonly oneWaySeconds: Quantityish | null | undefined;
  readonly source: CommsDelaySource;
}): number | null {
  if (input.source !== CommsDelaySource.SignalDelay) return null;
  const hops = input.hops;
  if (hops === undefined || hops.length === 0) return null;
  let route = 0;
  for (const hop of hops) {
    const metres = Number(hop?.distanceMeters);
    if (!Number.isFinite(metres)) return null;
    route += metres;
  }
  const seconds = Number(input.oneWaySeconds ?? Number.NaN);
  if (!(route > 0) || !(seconds > 0)) return null;
  return seconds / route;
}

/**
 * The one-way delay to a craft the command centre has not heard from, as the
 * straight-line separation of the home centre and the craft's catalog orbit at
 * `atUt`, at a measured light-speed scale, in seconds, or `null` when anything
 * it needs cannot be placed. Useful for telling the operator roughly how long a
 * craft's first signal takes before the mod has said. Used by the alarm host.
 *
 * It is an estimate and nothing more: the route is taken as direct, so a craft
 * reached by relays is under-estimated, and the home centre stands in for the
 * centre the session is at. A real delay replaces it as soon as one arrives.
 */
export function estimateOneWayDelaySeconds(input: {
  readonly secondsPerMetre: number;
  readonly roster: readonly CommandCentreEntry[] | undefined;
  readonly bodies: SystemBodies | undefined;
  readonly catalog: TrackingStationCatalog | undefined;
  readonly vesselId: string;
  readonly atUt: number;
}): number | null {
  const { secondsPerMetre, roster, bodies, catalog, vesselId, atUt } = input;
  if (!(secondsPerMetre > 0)) return null;
  const craft = catalogRelayOrbit(catalog, bodies, vesselId);
  if (craft === undefined) return null;
  const home = roster?.find((entry) => entry.isHome);
  if (home?.displayName == null) return null;
  const peer = locateCommsPeer(
    { id: home.displayName, isHome: true },
    roster,
    () => undefined,
  );
  if (peer === null) return null;
  const seconds = commsDelaySecondsAt(
    {
      secondsPerMetre,
      beyondFirstHopMetres: 0,
      craft,
      peer,
      facts: deriveCelestialFacts(bodies?.bodies),
    },
    atUt,
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
