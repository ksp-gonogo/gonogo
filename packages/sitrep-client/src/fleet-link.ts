import { useStream } from "./use-stream";

/**
 * Display-only per-vessel link facts (Plan 2c), read off `fleet.<guid>.delay`.
 *
 * `oneWaySeconds` is a BARE number, not a wrapped `Value<"s">` like the generated
 * `FleetVesselLink` contract type: `fleet.<guid>.*` is a dynamic topic the decode
 * path cannot unit-wrap (`wrapTopicPayload` keys on the exact topic string and a
 * per-guid topic matches no entry in the unit maps), so every field arrives as
 * the raw wire number. The generated type describes the WIRE contract; this is
 * the shape a client actually receives for the dynamic topic.
 */
export interface FleetVesselLink {
  /** One-way light-time to the vessel, seconds (bare wire number). null/absent when no path. */
  oneWaySeconds?: number | null;
  /** Whether the vessel is currently reachable. */
  connected: boolean;
}

/** The per-vessel delay + connectivity for fleet vessel `guid`, or undefined until it arrives. */
export function useFleetVesselLink(guid: string): FleetVesselLink | undefined {
  return useStream<FleetVesselLink>(`fleet.${guid}.delay`);
}
