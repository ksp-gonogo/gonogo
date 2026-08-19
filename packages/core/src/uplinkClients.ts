/**
 * Uplink client identity handles moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * `defineUplinkClient` is the first line of every Uplink's `uplink.ts`, so the
 * handle an Uplink stamps onto its registrations, and the registry a test reads
 * back, both have to be reachable from a published package.
 *
 * Everything it named was already sdk-side: `defineProcessor`, `registerReckoner`,
 * `contributeDerivedChannel` and the contribution registry that moved with it. The
 * loose `UplinkClientHandle` mirror the sdk carried is gone in the same change,
 * since the four spine types it could not name are all there now.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  CORE_UPLINK_CLIENT,
  clearUplinkClients,
  defineUplinkClient,
  getUplinkClients,
  type UplinkClientHandle,
} from "@ksp-gonogo/sitrep-sdk/spine";
