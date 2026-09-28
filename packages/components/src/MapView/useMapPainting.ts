import { getAugmentsForSlot } from "@ksp-gonogo/core";
import type { TrackSample } from "@ksp-gonogo/sitrep-client";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { EncounterKind } from "../shared/encounterKind";
import {
  type Camera,
  cameraTransform,
  WORLD_H,
  WORLD_W,
  worldToScreen,
} from "./camera";
import {
  type MapProjection,
  paintMapBase,
  paintModelledMarker,
  paintPrediction,
  paintVesselMarker,
  sizedContext,
} from "./canvasPaint";
import { groupBaseLayersByUplink } from "./orderBaseLayers";
import type { BaseSurfaceLayer } from "./paintBaseSurface";
import type { useBaseLayers } from "./useBaseLayers";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";

interface MapPaintingInputs {
  containerSize: { w: number; h: number } | null;
  camera: Camera;
  bodyTexture: string | undefined;
  bodyColor: string | undefined;
  baseLayers: ReturnType<typeof useBaseLayers>;
  worldCanvasRef: RefObject<HTMLCanvasElement | null>;
  trajectoryCount: number;
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
 * Keeps the five stacked map canvases painted: base surface, overlay, the
 * flown trail, the forward tracks and the vessel marker. Returns the refs to
 * mount them on, and whether the vessel marker is drawn.
 */
export function useMapPainting({
  containerSize,
  camera,
  bodyTexture,
  bodyColor,
  baseLayers,
  worldCanvasRef,
  trajectoryCount,
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

  // Cached in a ref so camera changes do not reload the texture.
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
    img.onload = () => {
      textureImageRef.current = img;
      setTextureReady(true);
    };
    img.onerror = () => setTextureReady(true);
    img.src = bodyTexture;
  }, [bodyTexture]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: baseLayers.version bumps when the map-view.base slot supplies (or withdraws) a canvas; the canvas reference is stable across mutations (tracked via a ref rather than state), so we depend on the version to trigger a redraw
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !containerSize || !textureReady) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;

    // Stackable layers composite in draw order over the stock texture. Suppression needs the suppressing augment's Domain live, and suppressed with every layer off stays black.
    const activeBaseAugments = getAugmentsForSlot("map-view.base");
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

  // trajectoryCount drives the redraw: the world canvas ref is stable but its content is not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trajectoryCount triggers redraw when world canvas content changes
  useEffect(() => {
    const canvas = persistentDataRef.current;
    const worldCanvas = worldCanvasRef.current;
    if (!canvas || !containerSize || !worldCanvas) return;
    const { w, h } = containerSize;
    const ctx = sizedContext(canvas, w, h);
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    // The trail is the vessel's track, meaningless projected through another body's frame.
    if (!vesselOnThisBody) return;
    ctx.setTransform(...cameraTransform(camera, w, h));
    ctx.drawImage(worldCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [containerSize, camera, trajectoryCount, vesselOnThisBody]);

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
    const { x, y } = worldToScreen(wx, wy, camera, w, h);
    paintVesselMarker(canvas, ctx, x, y, positionHeld);
    if (modelledPosition === null) return;
    const modelled = adjustedMap(
      WORLD_W,
      WORLD_H,
      modelledPosition.lat,
      modelledPosition.lon,
    );
    const at = worldToScreen(modelled.x, modelled.y, camera, w, h);
    paintModelledMarker(canvas, ctx, at.x, at.y);
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
