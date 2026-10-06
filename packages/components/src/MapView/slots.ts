export type {
  MapBaseLayerContext,
  MapOverlayContext,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * What this widget is currently looking at, published for every augment bound
 * to any of its slots. Read with `useWidgetScope("map-view")`.
 */
export interface MapViewScope {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
}
