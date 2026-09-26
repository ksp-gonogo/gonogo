import type { CoverageGate } from "./useCoverageGate";

/**
 * Props for `map-view.overlay`, a layer positioned over the map canvases.
 * `project` is the exact chain the base map draws with (per-body offset, then
 * camera); the raw pieces are there for an augment building its own transform.
 */
export interface MapOverlayContext {
  /** Pixel width of the overlay layer (== the map canvas container). */
  width: number;
  /** Pixel height of the overlay layer. */
  height: number;
  /** Live pan/zoom camera driving the equirectangular projection. */
  camera: { zoom: number; panX: number; panY: number };
  /** Equirectangular world-canvas width the camera maps from. */
  worldW: number;
  /** Equirectangular world-canvas height the camera maps from. */
  worldH: number;
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
  /** Mapped body physical radius, metres, when known. */
  bodyRadius: number | undefined;
  /** Project lat/lon (degrees) to a pixel in the overlay layer's own space. */
  project: (lat: number, lon: number) => { x: number; y: number };
  /**
   * The active vessel's raw lat/lon (no body offset applied). `undefined` with
   * no position fix, or when the mapped body is not the vessel's body.
   */
  vesselLat: number | undefined;
  vesselLon: number | undefined;
}

/**
 * What this widget is currently looking at, published for every augment bound
 * to any of its slots. Read with `useWidgetScope("map-view")`.
 */
export interface MapViewScope {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
}

/**
 * Props for `map-view.base`, the stackable replace slot for the map's base
 * surface. Each augment hands back a canvas via `onLayer` keyed by its own id,
 * and MapView composites them in draw order over the stock texture, which is
 * skipped outright when any augment here declares `suppressesVanillaBase`.
 */
export interface MapBaseLayerContext {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyId: string | undefined;
  width: number;
  height: number;
  /** Per-namespace augment settings. An augment reads its own `augmentSettings[itsOwnId]?.show`, default true when unset. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /** The paint gate for this body, sampled per output tile. `hasAnySource: false` means paint fully open, not paint nothing. */
  coverageGate: CoverageGate;
  /**
   * Called with a fresh canvas, or `null` to withdraw one. The first argument
   * must be the augment's own id, since several augments may hold a canvas at
   * once. Transparent pixels fall through to whatever paints beneath.
   */
  onLayer: (
    id: string,
    canvas: HTMLCanvasElement | null,
    version: number,
  ) => void;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "map-view.overlay": MapOverlayContext;
    "map-view.base": MapBaseLayerContext;
    // Mounted by `Panel`'s universal segments; declared so a binder types against the propless contract.
    "map-view.sections": Record<string, never>;
    "map-view.actions": Record<string, never>;
  }

  interface WidgetScopeRegistry {
    "map-view": MapViewScope;
  }
}
