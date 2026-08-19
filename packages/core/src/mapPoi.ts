/**
 * The map-POI registry moved to `@ksp-gonogo/sitrep-sdk`, types and all.
 *
 * Contributing a POI provider was already published (as a host shim), but
 * reading the registry back was not, so an Uplink could host a mapping surface
 * and had no supported way to assert what was on it. The definition types moved
 * with the registry rather than staying mirrored here: they were already
 * duplicated into the sdk's `api/types.ts` and held honest by the conformance
 * gate, and a registry and the shape it stores belong in one place.
 *
 * `MapView`'s `MapPoiLayer` is still the only consumer, and still owns the ONE
 * shared hover/action/marker-styling surface, so N providers do not each invent
 * their own hover UX.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  clearMapPoiProviders,
  getMapPoiProviders,
  type MapPoi,
  type MapPoiAction,
  type MapPoiProviderContext,
  type MapPoiProviderDefinition,
  onMapPoiProvidersChange,
  registerMapPoiProvider,
  type UseMapPois,
} from "@ksp-gonogo/sitrep-sdk";
