import { getAugmentsForSlot } from "@ksp-gonogo/core";
import type { TrackSample } from "@ksp-gonogo/sitrep-client";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { paintVesselKeyline, paintVesselPositions } from "@ksp-gonogo/ui-kit";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { EncounterKind } from "../shared/encounterKind";
import { type Camera, WORLD_H, WORLD_W, worldToScreen } from "./camera";
import {
  MAP_MARK,
  type MapProjection,
  paintCrosshair,
  paintMapBase,
  paintPrediction,
  paintTrail,
  paintVesselMarker,
  sizedContext,
  trailPoints,
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
  /** The flown trail's buffer, newest last, and how many points it has ever taken. */
  trajectoryRef: RefObject<TrajectoryPoint[]>;
  trajectoryCount: number;
  /** The body mapped, whose change starts the trail afresh. */
  bodyName: string | undefined;
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
 * Keeps the six stacked map canvases painted: base surface, overlay, the
 * flown trail, the forward tracks, the vessel marker's keyline and the marker. Returns the refs to
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
  bodyName,
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
  const keylineRef = useRef<HTMLCanvasElement>(null);
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

  // The buffer outlives a change of body, and the points flown over the last one are not this map's.
  const trailStartedAt = useRef(0);
  const trajectoryCountRef = useRef(trajectoryCount);
  trajectoryCountRef.current = trajectoryCount;
  // biome-ignore lint/correctness/useExhaustiveDependencies: bodyName is the change trigger, not consumed in the body
  useEffect(() => {
    trailStartedAt.current = trajectoryCountRef.current;
  }, [bodyName]);

  // trajectoryCount drives the redraw: the buffer's ref is stable but its content is not.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trajectoryCount and bodyName trigger the redraw when the buffer's content or its start changes
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
      points: vesselOnThisBody
        ? trailPoints(
            trajectoryRef.current ?? [],
            trajectoryCount,
            trailStartedAt.current,
          )
        : [],
      adjustedMap,
      hasAtmosphere,
      maxAtmosphere,
    });
  }, [
    containerSize,
    camera,
    trajectoryCount,
    bodyName,
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
    // The map under a mark is ocean, land, desert or ice, so each mark takes a keyline on the layer that inverts what is beneath it.
    const keylines = keylineRef.current
      ? sizedContext(keylineRef.current, w, h)
      : null;
    keylines?.clearRect(0, 0, w, h);

    if (!vesselMarked || lat === undefined || lon === undefined) return;
    const { x: wx, y: wy } = adjustedMap(
      WORLD_W,
      WORLD_H,
      lat.magnitude,
      lon.magnitude,
    );
    const { x, y } = worldToScreen(wx, wy, camera, w, h);
    if (modelledPosition === null && !positionHeld) {
      if (keylines) {
        paintVesselKeyline(keylines, "current", x, y, MAP_MARK.radius);
      }
      paintVesselMarker(canvas, ctx, x, y);
      return;
    }
    // The observation is held wherever it is not the current marker: the kit draws it as the held square, beside a modelled position where there is one.
    paintCrosshair(ctx, x, y, true);
    const modelled =
      modelledPosition === null
        ? undefined
        : adjustedMap(
            WORLD_W,
            WORLD_H,
            modelledPosition.lat,
            modelledPosition.lon,
          );
    const modelledAt =
      modelled === undefined
        ? undefined
        : worldToScreen(modelled.x, modelled.y, camera, w, h);
    if (keylines) {
      paintVesselKeyline(keylines, "held", x, y, MAP_MARK.radius);
      if (modelledAt) {
        paintVesselKeyline(
          keylines,
          "modelled",
          modelledAt.x,
          modelledAt.y,
          MAP_MARK.radius,
        );
      }
    }
    paintVesselPositions(
      canvas,
      ctx,
      { held: { x, y }, modelled: modelledAt },
      MAP_MARK.radius,
    );
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
    keylineRef,
    persistentDataRef,
    predictionRef,
    vesselMarked,
  };
}
