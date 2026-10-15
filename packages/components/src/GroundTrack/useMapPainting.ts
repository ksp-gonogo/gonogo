import { getAugmentsForSlot } from "@ksp-gonogo/core";
import type { TrackSample } from "@ksp-gonogo/sitrep-client";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { paintVesselPositions } from "@ksp-gonogo/ui-kit";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { EncounterKind } from "../shared/encounterKind";
import {
  type Camera,
  nearestRepeatX,
  WORLD_H,
  WORLD_W,
  worldRepeats,
  worldToScreen,
} from "./camera";
import {
  MAP_MARK,
  type MapProjection,
  paintCrosshair,
  paintMapBase,
  paintPrediction,
  paintTrail,
  paintVesselMarker,
  sizedContext,
} from "./canvasPaint";
import { groupBaseLayersByUplink } from "./orderBaseLayers";
import type { BaseSurfaceLayer } from "./paintBaseSurface";
import type { useBaseLayers } from "./useBaseLayers";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";

interface MapPaintingInputs {
  containerSize: { w: number; h: number } | null;
  camera: Camera;
  bodyTexture: string | undefined;
  bodyColor: string | undefined;
  baseLayers: ReturnType<typeof useBaseLayers>;
  /** The flown trail's buffer, newest last, and a count that moves whenever its content does. */
  trajectoryRef: RefObject<TrajectoryPoint[]>;
  trajectoryCount: number;
  hasAtmosphere: boolean | undefined;
  maxAtmosphere: number | undefined;
  vesselOnThisBody: boolean;
  predictionSegments: TrackSample[][];
  maneuverSegments: TrackSample[][][];
  impactLat: number | undefined;
  impactLon: number | undefined;
  adjustedMap: MapProjection;
  encounterKind: EncounterKind | null;
  lat: Value<"°"> | undefined;
  lon: Value<"°"> | undefined;
  /** See `MapTelemetry.positionHeld`. */
  positionHeld: boolean;
  /** See `MapTelemetry.modelledPosition`. */
  modelledPosition: { lat: number; lon: number } | null;
}

/**
 * The body's texture, loaded once per body and held in a ref so camera changes do not reload it. `textureReady` is true once the load has settled, with or without a picture, so the map paints either way.
 */
export function useBodyTexture(bodyTexture: string | undefined) {
  const textureImageRef = useRef<HTMLImageElement | null>(null);
  const [textureReady, setTextureReady] = useState(false);

  useEffect(() => {
    textureImageRef.current = null;
    setTextureReady(false);
    if (!bodyTexture) {
      setTextureReady(true);
      return;
    }
    const img = new Image();
    // A load that finishes after the body changed must not install the old body's texture.
    let current = true;
    img.onload = () => {
      if (!current) return;
      textureImageRef.current = img;
      setTextureReady(true);
    };
    img.onerror = () => {
      if (current) setTextureReady(true);
    };
    img.src = bodyTexture;
    return () => {
      current = false;
    };
  }, [bodyTexture]);

  return { textureImageRef, textureReady };
}

/**
 * Keeps the five stacked map canvases painted: base surface, overlay, the
 * flown trail, the forward tracks and the vessel marker, each in every repeat
 * of the world in view. Returns the refs to
 * mount them on, and whether the vessel marker is drawn.
 */
export function useMapPainting({
  containerSize,
  camera,
  bodyTexture,
  bodyColor,
  baseLayers,
  trajectoryRef,
  trajectoryCount,
  hasAtmosphere,
  maxAtmosphere,
  vesselOnThisBody,
  predictionSegments,
  maneuverSegments,
  impactLat,
  impactLon,
  adjustedMap,
  encounterKind,
  lat,
  lon,
  positionHeld,
  modelledPosition,
}: Readonly<MapPaintingInputs>) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<HTMLCanvasElement>(null);
  const persistentDataRef = useRef<HTMLCanvasElement>(null);
  const predictionRef = useRef<HTMLCanvasElement>(null);

  const { textureImageRef, textureReady } = useBodyTexture(bodyTexture);

  // biome-ignore lint/correctness/useExhaustiveDependencies: baseLayers.version bumps when the ground-track.base slot supplies (or withdraws) a canvas; the canvas reference is stable across mutations (tracked via a ref rather than state), so we depend on the version to trigger a redraw
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !containerSize || !textureReady) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;

    // Stackable layers composite in draw order over the stock texture. Suppression needs the suppressing augment's Domain live, and suppressed with every layer off stays black.
    const activeBaseAugments = getAugmentsForSlot("ground-track.base");
    const suppressVanilla = shouldSuppressVanillaBase(
      activeBaseAugments.map((a) => ({
        suppressesVanillaBase: a.suppressesVanillaBase,
        available:
          baseLayers.suppressionAvailabilityRef.current.get(a.id) === true,
      })),
    );
    const layers: BaseSurfaceLayer[] = [];
    for (const augment of groupBaseLayersByUplink(activeBaseAugments)) {
      const layerCanvas = baseLayers.canvasesRef.current.get(augment.id);
      if (layerCanvas) layers.push({ id: augment.id, canvas: layerCanvas });
    }
    paintMapBase(canvas, ctx, {
      w,
      h,
      camera,
      textureImage: textureImageRef.current,
      bodyColor,
      suppressVanilla,
      layers,
    });
  }, [containerSize, camera, textureReady, bodyColor, baseLayers.version]);

  // The overlay canvas is cleared only: coverage is a paint gate handed to base augments, not a drawn overlay.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
  }, [containerSize]);

  // trajectoryCount drives the redraw: the buffer's ref is stable but its content is not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trajectoryCount triggers the redraw when the buffer's content changes
  useEffect(() => {
    const canvas = persistentDataRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;
    paintTrail(ctx, {
      w,
      h,
      camera,
      // The trail is the vessel's track, meaningless projected through another body's frame.
      points: vesselOnThisBody ? (trajectoryRef.current ?? []) : [],
      adjustedMap,
      hasAtmosphere,
      maxAtmosphere,
    });
  }, [
    containerSize,
    camera,
    trajectoryCount,
    vesselOnThisBody,
    adjustedMap,
    hasAtmosphere,
    maxAtmosphere,
  ]);

  useEffect(() => {
    const canvas = predictionRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;
    paintPrediction(ctx, {
      w,
      h,
      camera,
      predictionSegments,
      maneuverSegments,
      adjustedMap,
      encounterKind,
      impactLat,
      impactLon,
    });
  }, [
    containerSize,
    camera,
    predictionSegments,
    maneuverSegments,
    impactLat,
    impactLon,
    adjustedMap,
    encounterKind,
  ]);

  // Only on the vessel's own body, and never with a NaN position.
  const vesselMarked =
    vesselOnThisBody &&
    lat !== undefined &&
    lon !== undefined &&
    lat.isFinite() &&
    lon.isFinite();

  useEffect(() => {
    const canvas = dataRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    if (!vesselMarked || lat === undefined || lon === undefined) return;
    const { x: wx, y: wy } = adjustedMap(
      WORLD_W,
      WORLD_H,
      lat.magnitude,
      lon.magnitude,
    );
    // The modelled position sits in the same repeat of the world as the held one beside it.
    const modelled =
      modelledPosition === null
        ? undefined
        : adjustedMap(
            WORLD_W,
            WORLD_H,
            modelledPosition.lat,
            modelledPosition.lon,
          );
    const margin = MAP_MARK.crosshair + MAP_MARK.radius;
    for (const shift of worldRepeats(wx, wx, camera, w, margin)) {
      const { x, y } = worldToScreen(wx + shift, wy, camera, w, h);
      if (modelled === undefined && !positionHeld) {
        paintVesselMarker(canvas, ctx, x, y);
        continue;
      }
      // The observation is held wherever it is not the current marker: the kit draws it as the held square, beside a modelled position where there is one.
      paintCrosshair(ctx, x, y, true);
      const modelledAt =
        modelled === undefined
          ? undefined
          : worldToScreen(
              nearestRepeatX(modelled.x, wx) + shift,
              modelled.y,
              camera,
              w,
              h,
            );
      paintVesselPositions(
        canvas,
        ctx,
        { held: { x, y }, modelled: modelledAt },
        MAP_MARK.radius,
        { keyline: true },
      );
    }
  }, [
    containerSize,
    camera,
    lat,
    lon,
    adjustedMap,
    vesselMarked,
    positionHeld,
    modelledPosition,
  ]);

  return {
    baseRef,
    overlayRef,
    dataRef,
    persistentDataRef,
    predictionRef,
    vesselMarked,
  };
}
