// Mod-agnostic registry for map points of interest. A POI provider
// contributes DATA (an array of points for the currently-mapped body),
// not a renderable component — same reasoning as fogReveal.ts: MapView
// owns the ONE shared hover/action/marker-styling surface so N providers
// don't each invent their own hover UX. Consumed by MapView's
// MapPoiLayer (packages/components/src/MapView/MapPoiLayer.tsx).

export interface MapPoiAction {
  id: string;
  label: string;
  run: () => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

export interface MapPoi {
  /** Unique within the OWNING PROVIDER's namespace. */
  id: string;
  /** Body NAME, matches MapView's own bodyName convention. */
  bodyId: string;
  lat: number;
  lon: number;
  /** Open string, not a closed union — third-party kinds fall back to a generic style. */
  kind: string;
  label: string;
  detail?: string;
  status?: "active" | "available" | "info";
  meta?: Record<string, unknown>;
  actions?: readonly MapPoiAction[];
}

export interface MapPoiProviderContext {
  /** MapView's currently-mapped body. */
  bodyId: string | undefined;
}

export type UseMapPois = (
  ctx: MapPoiProviderContext,
) => readonly MapPoi[] | null | undefined;

export interface MapPoiProviderDefinition {
  /** "<uplinkId>:<name>", e.g. "vanilla:spaceCenter", "example-uplink:anomalies". */
  id: string;
  /** Domain presence gate, same semantics as AugmentDefinition.requires. */
  requires?: string;
  usePois: UseMapPois;
}

const mapPoiProviders = new Map<
  string,
  { def: MapPoiProviderDefinition; order: number }
>();
let registrationCounter = 0;

const changeListeners = new Set<() => void>();
function notifyChange(): void {
  for (const cb of changeListeners) cb();
}

export function onMapPoiProvidersChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

export function registerMapPoiProvider(def: MapPoiProviderDefinition): void {
  mapPoiProviders.set(def.id, { def, order: registrationCounter++ });
  notifyChange();
}

export function getMapPoiProviders(): MapPoiProviderDefinition[] {
  return Array.from(mapPoiProviders.values())
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.def);
}

export function clearMapPoiProviders(): void {
  mapPoiProviders.clear();
  registrationCounter = 0;
  notifyChange();
}
