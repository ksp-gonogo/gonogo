import { useDataValue } from "./useDataValue";

/**
 * Consolidated apo/peri/timeToAp/timeToPe orbital readings.
 *
 * Each field is `undefined` until the underlying data source emits a value
 * (or after a non-`connected` status transition clears it), mirroring
 * `useDataValue` semantics.
 */
export interface OrbitElements {
  /** `o.ApR` — apoapsis radius from body centre, metres. */
  apoapsisRadius?: number;
  /** `o.PeR` — periapsis radius from body centre, metres. */
  periapsisRadius?: number;
  /** `o.ApA` — apoapsis altitude above body surface, metres. */
  apoapsisAltitude?: number;
  /** `o.PeA` — periapsis altitude above body surface, metres. */
  periapsisAltitude?: number;
  /** `o.timeToAp` — seconds until next apoapsis pass. */
  timeToApoapsis?: number;
  /** `o.timeToPe` — seconds until next periapsis pass. */
  timeToPeriapsis?: number;
}

/**
 * Read the standard apo/peri/timeToAp/timeToPe orbital elements from a single
 * data source in one call. Defaults to the buffered `"data"` source registered
 * by `@gonogo/data`.
 */
export function useOrbitElements(dataSourceId: string = "data"): OrbitElements {
  const apoapsisRadius = useDataValue<number>(dataSourceId, "o.ApR");
  const periapsisRadius = useDataValue<number>(dataSourceId, "o.PeR");
  const apoapsisAltitude = useDataValue<number>(dataSourceId, "o.ApA");
  const periapsisAltitude = useDataValue<number>(dataSourceId, "o.PeA");
  const timeToApoapsis = useDataValue<number>(dataSourceId, "o.timeToAp");
  const timeToPeriapsis = useDataValue<number>(dataSourceId, "o.timeToPe");

  return {
    apoapsisRadius,
    periapsisRadius,
    apoapsisAltitude,
    periapsisAltitude,
    timeToApoapsis,
    timeToPeriapsis,
  };
}
