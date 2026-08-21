import { useTelemetry } from "../hooks/useTelemetry";

/**
 * `useTelemetry` reached through its implementation signature, which still
 * accepts the legacy `(dataSourceId, key)` pair.
 *
 * The public overload list declares the one-argument topic form only, on
 * purpose: `use-telemetry.ts` states that the compile break IS the migration,
 * so widening the declared surface back out would undo the thing that moves
 * call sites off the pair. The runtime branch is still there and still
 * supported, and these tests are what says so, so the tests need a way to call
 * it that does not argue with the overload.
 *
 * One alias, in one place, rather than a cast at each of the ~20 call sites:
 * when the legacy branch is finally deleted, this file is the single thing that
 * stops compiling, which is the notice you want.
 */
export const useLegacyTelemetry = useTelemetry as unknown as (
  dataSourceId: string,
  key: string,
) => unknown;
