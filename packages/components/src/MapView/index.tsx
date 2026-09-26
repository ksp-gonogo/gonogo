import type {
  ActionDefinition,
  AnyAugment,
  ComponentProps,
  TrackSample,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  getImagingWindow,
  latLonToMap,
  onAugmentsChange,
  predictGroundTrack,
  registerComponent,
  useActionInput,
  useAugmentAvailable,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  mapOrbitPatch,
  type OrbitTrajectory,
  predictImpactPoint,
  useOrbitTrajectory,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type { VesselManeuver } from "@ksp-gonogo/sitrep-sdk";
import { Switch } from "@ksp-gonogo/ui";
import {
  kspCalendar,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Unit,
  WidgetScopeProvider,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encounterKindOf } from "../shared/encounterKind";
import { magnitudeOf } from "../shared/magnitude";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";
import { bodyNamed } from "../shared/streamBody";
import { trajectoryWithheldCopy } from "../shared/trajectoryWithheld";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import {
  cameraTransform,
  fitCamera,
  followZoom,
  WORLD_H,
  WORLD_W,
  worldToScreen,
  zoomBounds,
} from "./camera";
import { splitOnDrawnLongitudeWrap } from "./groundTrackWrap";
import { MapPoiLayer } from "./MapPoiLayer";
import {
  BaseCanvas,
  BodyLabel,
  CanvasContainer,
  CompactLabel,
  CompactReadout,
  CompactRow,
  CompactValue,
  DataCanvas,
  ImagingChip,
  MapBody,
  MapFrame,
  MapOuter,
  MapSections,
  NoSignal,
  OverlayAugmentLayer,
  OverlayCanvas,
  PersistentDataCanvas,
  PredictionCanvas,
} from "./MapView.styles";
import { MapViewConfigComponent } from "./MapViewConfig";
import { groupBaseLayersByUplink } from "./orderBaseLayers";
import {
  type BaseSurfaceLayer,
  baseSurfacePainted,
  paintBaseSurface,
} from "./paintBaseSurface";
import { quantiseUt } from "./predictionThrottle";
import type { MapViewConfig } from "./types";
import { useCamera } from "./useCamera";
import { type CoverageGate, useCoverageGate } from "./useCoverageGate";
import { useMapResize } from "./useMapResize";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";
import { useWorldCanvas } from "./useWorldCanvas";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";
// Side-effect only: registers the vanilla POI provider MapPoiLayer renders.
import "./vanillaPoiProvider";

const topics = defineTopicManifest({
  /* `system.bodies` is matched by the name the running game reports, not the bundled stock table. `vessel.orbit` also carries the next apsis the chip row solves from its elements. */
  channels: [
    "vessel.flight",
    "vessel.orbit",
    "vessel.identity",
    "system.bodies",
  ],
  fields: [
    "vessel.flight.latitude",
    "vessel.flight.longitude",
    "vessel.flight.altitudeAsl",
    "vessel.flight.altitudeTerrain",
    "vessel.flight.verticalSpeed",
    "vessel.identity.parentBodyIndex",
    "vessel.orbit.patches",
    "vessel.orbit.encounter",
    "vessel.orbit.mu",
    "vessel.orbit.horizon",
    "vessel.orbit.arc",
  ],
});

/**
 * Resolve a CSS custom property to a concrete colour for a `<canvas>` 2D
 * context, which cannot resolve `var(--...)` and paints black when handed one.
 */
function canvasColor(
  el: HTMLElement,
  varName: string,
  fallback: string,
): string {
  const v = getComputedStyle(el).getPropertyValue(varName).trim();
  return v || fallback;
}

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

const mapViewActions = [
  {
    id: "toggleFollow",
    label: "Toggle Follow",
    accepts: ["button"],
    description: "Switch between global and follow view.",
  },
  {
    id: "zoomIn",
    label: "Zoom In",
    accepts: ["button"],
  },
  {
    id: "zoomOut",
    label: "Zoom Out",
    accepts: ["button"],
  },
  {
    id: "resetView",
    label: "Reset View",
    accepts: ["button"],
    description: "Fit the whole map and exit follow mode.",
  },
] as const satisfies readonly ActionDefinition[];

export type MapViewActions = typeof mapViewActions;

const ZOOM_STEP = 1.3;

/**
 * Stroke longitude-wrap-split segments with one fade continuous across the
 * whole list. Caller owns transform, lineWidth and dash.
 */
function drawFadedSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly TrackSample[][],
  toMap: (
    w: number,
    h: number,
    lat: number,
    lon: number,
  ) => { x: number; y: number },
  rgb: readonly [number, number, number],
): void {
  const total = segments.reduce((sum, seg) => sum + seg.length, 0);
  if (total === 0) return;
  const [r, g, b] = rgb;
  let globalIndex = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const prev = segment[i - 1];
      const curr = segment[i];
      const { x: x0, y: y0 } = toMap(WORLD_W, WORLD_H, prev.lat, prev.lon);
      const { x: x1, y: y1 } = toMap(WORLD_W, WORLD_H, curr.lat, curr.lon);
      const t = (globalIndex + i) / Math.max(1, total - 1);
      const alpha = Math.max(0.15, 1 - 0.85 * t);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    globalIndex += segment.length;
  }
}

/**
 * Reports one `map-view.base` augment's live Domain availability, through the
 * same `useAugmentAvailable` gate `<AugmentSlot>` applies. One component per
 * augment so the hook underneath keeps a stable position. Renders nothing.
 */
function VanillaSuppressionProbe({
  augment,
  onAvailableChange,
}: Readonly<{
  augment: AnyAugment;
  onAvailableChange: (id: string, available: boolean) => void;
}>) {
  const available = useAugmentAvailable(augment);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports on every value change; onAvailableChange is a stable host callback (useCallback with an empty dep list)
  useEffect(() => {
    onAvailableChange(augment.id, available);
    return () => onAvailableChange(augment.id, false);
  }, [augment.id, available]);
  return null;
}

function MapViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<MapViewConfig>>) {
  const trajectoryLength = config?.trajectoryLength ?? 2000;
  const showPrediction = config?.showPrediction ?? true;
  const bodyOverride = config?.bodyOverride;
  // Vanilla POIs are reference points, not an opt-in feature: default on.
  const showPois = config?.showPois ?? true;

  const flightReading = useTelemetry("vessel.flight");
  // The HUD readouts show the last observed numbers, captioned with their age.
  const flight =
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value
      : undefined;
  /* The marker is a claim about where the craft is now, so it comes from a current reading or a model, never a held one. The conic does not move lat/lon (the body-fixed mapping is not on the wire), so the dot still draws from the last observed pair under a model. */
  const flightObserved =
    flightReading.state === "observed" || flightReading.state === "stale"
      ? flightReading.value
      : undefined;
  const positioned =
    flightObserved && flightReading.reckoning.status === "available"
      ? { ...flightObserved, ...flightReading.reckoning.value }
      : flightReading.state === "observed"
        ? flightReading.value
        : undefined;
  // True exactly when no marker is drawn: a stale reading with a model still draws.
  const positionStale =
    flightReading.state === "stale" &&
    flightReading.reckoning.status !== "available";
  const lat = positioned?.latitude;
  const lon = positioned?.longitude;
  /* `altitudeReading` feeds the readout, which marks its own currency. `altSea` is the last observed magnitude and feeds the flown trail, where a modelled altitude does not belong. */
  const altitudeReading = flightReading.altitudeAsl;
  const altSea =
    (altitudeReading.state === "observed" || altitudeReading.state === "stale"
      ? magnitudeOf(altitudeReading.value)
      : undefined) ?? undefined;
  // The imaging verdict is about now: modelled altitude if on offer, else a current observation.
  const altSeaReadout =
    magnitudeOf(
      altitudeReading.reckoning.status === "available"
        ? altitudeReading.reckoning.modelled
        : altitudeReading.state === "observed"
          ? altitudeReading.value
          : undefined,
    ) ?? undefined;
  const bodyName = useBodyName(useParentBodyIndex()) ?? undefined;
  const q = flight?.dynamicPressureKPa;
  const mach = flight?.mach;
  const speed = flight?.surfaceSpeed?.magnitude;
  const vSpeed = flight?.verticalSpeed;
  // A patch carries no shape: the horizon's `trajectoryKind` decides whether a Kepler solve fits.
  const orbitReading = useTelemetry("vessel.orbit");
  /* The observation overlaid by what the conic moved (the phase). `reckoning.value` alone is not an orbit. */
  const orbitSampleObserved =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbitSample =
    orbitSampleObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitSampleObserved, ...orbitReading.reckoning.value }
        : orbitSampleObserved;
  // Holds when stale. Memoised on the sample so the memos keyed on the array rerun only on a new sample.
  const orbitPatches = useMemo(
    () =>
      orbitSampleObserved === undefined
        ? undefined
        : (orbitSampleObserved.patches ?? []).map(mapOrbitPatch),
    [orbitSampleObserved],
  );
  // The encounter and impact point are markers, so they need a current reading.
  const orbitCurrent =
    orbitReading.state === "observed" ? orbitReading.value : undefined;
  const flightCurrent =
    flightReading.state === "observed" ? flightReading.value : undefined;
  // Only the marker draw cares which kind; the chips own the body and time.
  const encounterKind = encounterKindOf(orbitCurrent?.encounter);
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbitSample);
  const trajectoryWithheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  // No refusal caption before the first elements arrive: a cold stream is not a refusal.
  const hasPatchChain = (orbitPatches?.length ?? 0) > 0;
  const planReading = useStream<VesselManeuver>("vessel.maneuver");
  const maneuverNodes =
    planReading.state === "observed" || planReading.state === "stale"
      ? planReading.value.nodes
      : undefined;
  const universalTime = useViewUt()?.magnitude;
  const predictionEnabled = showPrediction;

  // The body picker (config.bodyOverride) lets the operator inspect any body; unset follows the vessel.
  const targetBodyId = bodyOverride ?? bodyName;
  /* Radius and rotation period come off `system.bodies`, matched by name, so a planet-pack rename still gets a ground track. */
  const bodiesReading = useTelemetry("system.bodies");
  /* A body's radius does not decay, so a stale roster is the right read. */
  const bodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
  /* Memoised: an unmemoised merge would re-solve Kepler every render and defeat the `utBucket` throttle. */
  const body = useMemo(
    () => bodyNamed(bodies, targetBodyId),
    [bodies, targetBodyId],
  );
  const impact = useMemo(
    () =>
      orbitCurrent === undefined ||
      flightCurrent === undefined ||
      universalTime === undefined
        ? null
        : predictImpactPoint({
            orbit: orbitCurrent,
            flight: flightCurrent,
            bodies,
            viewUt: universalTime,
          }),
    [orbitCurrent, flightCurrent, bodies, universalTime],
  );
  // (0, 0) is the "no prediction" sentinel, never a point to mark.
  const impactMarked =
    impact !== null &&
    Number.isFinite(impact.lat) &&
    Number.isFinite(impact.lon) &&
    !(impact.lat === 0 && impact.lon === 0);
  const impactLat = impactMarked ? impact.lat : undefined;
  const impactLon = impactMarked ? impact.lon : undefined;
  // An override that diverges from the vessel's body suppresses every vessel-relative draw and the follow chrome.
  const vesselOnThisBody = !bodyOverride || bodyOverride === bodyName;

  const { outerRef, containerSize } = useMapResize();
  const {
    camera,
    setCamera,
    baseZoom,
    viewMode,
    setViewMode,
    interactionRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  } = useCamera(containerSize);

  useActionInput<MapViewActions>({
    toggleFollow: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = viewMode === "follow" ? "global" : "follow";
      setViewMode(next);
      return { follow: next === "follow" };
    },
    zoomIn: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      setCamera((prev) => {
        const { min, max } = zoomBounds(baseZoom);
        return {
          ...prev,
          zoom: Math.max(min, Math.min(max, prev.zoom * ZOOM_STEP)),
        };
      });
      return undefined;
    },
    zoomOut: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      setCamera((prev) => {
        const { min, max } = zoomBounds(baseZoom);
        return {
          ...prev,
          zoom: Math.max(min, Math.min(max, prev.zoom / ZOOM_STEP)),
        };
      });
      return undefined;
    },
    resetView: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const w = containerSize?.w ?? WORLD_W;
      const h = containerSize?.h ?? WORLD_H;
      setCamera(fitCamera(w, h));
      setViewMode("global");
      return undefined;
    },
  });

  const { trajectoryRef, trajectoryCount } = useTrajectoryBuffer({
    lat: lat?.magnitude,
    lon: lon?.magnitude,
    altSea,
    q: q?.magnitude,
    mach: mach?.magnitude,
    speed,
    vSpeed: vSpeed?.magnitude,
    trajectoryLength,
  });

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<HTMLCanvasElement>(null);
  const persistentDataRef = useRef<HTMLCanvasElement>(null);
  const predictionRef = useRef<HTMLCanvasElement>(null);

  // Keyed by each contributing augment's own id. A ref, not state: `baseLayerVersion` is what triggers the redraw.
  const baseLayerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(
    new Map(),
  );
  const [baseLayerVersion, setBaseLayerVersion] = useState(0);
  const onBaseLayer = useCallback(
    (id: string, canvas: HTMLCanvasElement | null, _version: number) => {
      if (canvas) baseLayerCanvasesRef.current.set(id, canvas);
      else baseLayerCanvasesRef.current.delete(id);
      // An own counter rather than the caller's version: two augments in the same millisecond could hand back the same number and React would skip the render.
      setBaseLayerVersion((v) => v + 1);
    },
    [],
  );

  // Live Domain availability per suppressing `map-view.base` augment: registry presence is not the Domain being live.
  const suppressionAvailabilityRef = useRef<Map<string, boolean>>(new Map());
  const onSuppressAvailabilityChange = useCallback(
    (id: string, available: boolean) => {
      if (available) suppressionAvailabilityRef.current.set(id, true);
      else suppressionAvailabilityRef.current.delete(id);
      setBaseLayerVersion((v) => v + 1);
    },
    [],
  );

  // The probe list is read from the registry at render time, so an augment registered after mount needs this to get a probe.
  useEffect(
    () => onAugmentsChange(() => setBaseLayerVersion((v) => v + 1)),
    [],
  );

  // Per-augment settings off the saved config; `undefined` means no overrides.
  const augmentSettings: Record<string, Record<string, unknown>> | undefined =
    config?.augmentSettings;

  // Zero registered coverage sources means paint fully open, not paint nothing.
  const coverageGate = useCoverageGate(targetBodyId, augmentSettings);

  // Per-body coordinate offsets: applied in both world canvas and screen space
  const adjustedMap = useCallback(
    (canvasW: number, canvasH: number, rawLat: number, rawLon: number) => {
      const lonOff = body?.longitudeOffset ?? 0;
      const latOff = body?.latitudeOffset ?? 0;
      const adjLon = ((((rawLon + lonOff + 180) % 360) + 360) % 360) - 180;
      const adjLat = Math.max(-90, Math.min(90, rawLat + latOff));
      return latLonToMap(adjLat, adjLon, canvasW, canvasH);
    },
    [body?.latitudeOffset, body?.longitudeOffset],
  );

  const worldCanvasRef = useWorldCanvas({
    trajectoryRef,
    trajectoryCount,
    adjustedMap,
    hasAtmosphere: body?.hasAtmosphere,
    maxAtmosphere: body?.maxAtmosphere,
    bodyName: targetBodyId,
  });

  useEffect(() => {
    if (viewMode !== "follow" || lat === undefined || lon === undefined) return;
    const { x: wx, y: wy } = adjustedMap(
      WORLD_W,
      WORLD_H,
      lat.magnitude,
      lon.magnitude,
    );
    setCamera({
      zoom: followZoom(speed ?? 0, baseZoom),
      panX: wx,
      panY: wy,
    });
  }, [viewMode, lat, lon, speed, adjustedMap, baseZoom, setCamera]);

  // Cached in a ref so camera changes do not reload the texture.
  const textureImageRef = useRef<HTMLImageElement | null>(null);
  const [textureReady, setTextureReady] = useState(false);

  useEffect(() => {
    textureImageRef.current = null;
    setTextureReady(false);
    if (!body?.texture) {
      setTextureReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      textureImageRef.current = img;
      setTextureReady(true);
    };
    img.onerror = () => setTextureReady(true);
    img.src = body.texture;
  }, [body?.texture]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: baseLayerVersion bumps when the map-view.base slot supplies (or withdraws) a canvas; the canvas reference is stable across mutations (tracked via a ref rather than state), so we depend on the version to trigger a redraw
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !containerSize || !textureReady) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const textureImage = textureImageRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = canvasColor(canvas, "--color-surface-panel", "#0d0d0d");
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(...cameraTransform(camera, w, h));

    // Stackable layers composite in draw order over the stock texture. Suppression needs the suppressing augment's Domain live, and suppressed with every layer off stays black.
    const activeBaseAugments = getAugmentsForSlot("map-view.base");
    const suppressVanilla = shouldSuppressVanillaBase(
      activeBaseAugments.map((a) => ({
        suppressesVanillaBase: a.suppressesVanillaBase,
        available: suppressionAvailabilityRef.current.get(a.id) === true,
      })),
    );
    const orderedLayers: BaseSurfaceLayer[] = [];
    for (const augment of groupBaseLayersByUplink(activeBaseAugments)) {
      const layerCanvas = baseLayerCanvasesRef.current.get(augment.id);
      if (layerCanvas)
        orderedLayers.push({ id: augment.id, canvas: layerCanvas });
    }
    paintBaseSurface(ctx, {
      textureImage,
      bodyColor: body?.color,
      suppressVanilla,
      layers: orderedLayers,
      worldW: WORLD_W,
      worldH: WORLD_H,
    });

    // lineWidth compensates for zoom so grid lines stay 1 screen pixel. Keyed off paintBaseSurface's own predicate so it cannot disagree with what was painted.
    const surfacePainted = baseSurfacePainted({
      textureImage,
      bodyColor: body?.color,
      suppressVanilla,
      layers: orderedLayers,
    });
    ctx.strokeStyle = surfacePainted
      ? "rgba(255,255,255,0.05)"
      : canvasColor(canvas, "--color-surface-raised", "#1a1a1a");
    ctx.lineWidth = 1 / camera.zoom;
    for (let lat30 = -60; lat30 <= 60; lat30 += 30) {
      const { y } = latLonToMap(lat30, 0, WORLD_W, WORLD_H);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
    }
    for (let lon30 = -150; lon30 <= 180; lon30 += 30) {
      const { x } = latLonToMap(0, lon30, WORLD_W, WORLD_H);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_H);
      ctx.stroke();
    }

    ctx.strokeStyle = surfacePainted
      ? "rgba(255,255,255,0.15)"
      : canvasColor(canvas, "--color-border-subtle", "#2a2a2a");
    ctx.lineWidth = 1.5 / camera.zoom;
    const { y: eqY } = latLonToMap(0, 0, WORLD_W, WORLD_H);
    ctx.beginPath();
    ctx.moveTo(0, eqY);
    ctx.lineTo(WORLD_W, eqY);
    ctx.stroke();
    const { x: pmX } = latLonToMap(0, 0, WORLD_W, WORLD_H);
    ctx.beginPath();
    ctx.moveTo(pmX, 0);
    ctx.lineTo(pmX, WORLD_H);
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [containerSize, camera, textureReady, body?.color, baseLayerVersion]);

  // The overlay canvas is cleared only: coverage is a paint gate handed to base augments, not a drawn overlay.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
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
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    // The trail is the vessel's track, meaningless projected through another body's frame.
    if (vesselOnThisBody) {
      ctx.setTransform(...cameraTransform(camera, w, h));
      ctx.drawImage(worldCanvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }, [containerSize, camera, trajectoryCount, vesselOnThisBody]);

  // Throttled to once a second via `quantiseUt`: body-rotation drift over a second is about 0.1 degree of longitude.
  const utBucket = quantiseUt(universalTime, 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lat/lon/universalTime read inside, but invalidation gated on utBucket; see comment above
  const predictionSegments = useMemo<TrackSample[][]>(() => {
    if (!predictionEnabled) return [];
    // Conic only: an integrated path carries no lat/lon on the wire, and a two-body guess would lay a route the craft will not fly.
    if (trajectory?.shape !== "conic") return [];
    if (
      !orbitPatches ||
      orbitPatches.length === 0 ||
      !targetBodyId ||
      body?.rotationPeriod === undefined ||
      lat === undefined ||
      lon === undefined ||
      universalTime === undefined
    ) {
      return [];
    }
    const firstForBody = orbitPatches.find(
      (p) => p.referenceBody === targetBodyId,
    );
    if (!firstForBody) return [];
    // 1.5 periods shows the closed loop, capped at one calendar day (about one rotation, which a planet pack changes).
    const horizon = Math.min(1.5 * firstForBody.period, kspCalendar().day);
    const samples = predictGroundTrack(
      orbitPatches,
      targetBodyId,
      body.radius,
      body.rotationPeriod,
      { ut: universalTime, lat: lat.magnitude, lon: lon.magnitude },
      horizon,
      10,
    );
    return splitOnDrawnLongitudeWrap(samples, body.longitudeOffset ?? 0);
  }, [
    predictionEnabled,
    orbitPatches,
    trajectory,
    targetBodyId,
    body,
    utBucket,
  ]);

  // Each node's patches are the post-burn trajectory, calibrated from the current orbit's patches.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lat/lon/universalTime read inside, but invalidation gated on utBucket
  const maneuverSegments = useMemo<TrackSample[][][]>(() => {
    if (!predictionEnabled) return [];
    if (
      !orbitPatches ||
      !maneuverNodes ||
      maneuverNodes.length === 0 ||
      !targetBodyId ||
      body?.rotationPeriod === undefined ||
      lat === undefined ||
      lon === undefined ||
      universalTime === undefined
    ) {
      return [];
    }
    // Capture past the outer guard so TS doesn't re-widen inside the map callback below.
    const bodyRadius = body.radius;
    const rotPeriod = body.rotationPeriod;
    const longitudeOffset = body.longitudeOffset ?? 0;
    return maneuverNodes.map((node) => {
      const patches = (node.patches ?? []).map(mapOrbitPatch);
      const firstPatch = patches.find((p) => p.referenceBody === targetBodyId);
      if (!firstPatch) return [];
      // Horizon extends from ref.ut up through the maneuver and 1.5 × its first post-burn period: enough to see the new orbit close up.
      const horizon = Math.min(
        node.ut.magnitude - universalTime + 1.5 * firstPatch.period,
        kspCalendar().day,
      );
      if (horizon <= 0) return [];
      const samples = predictGroundTrack(
        patches,
        targetBodyId,
        bodyRadius,
        rotPeriod,
        { ut: universalTime, lat: lat.magnitude, lon: lon.magnitude },
        horizon,
        10,
        orbitPatches,
      );
      return splitOnDrawnLongitudeWrap(samples, longitudeOffset);
    });
  }, [
    predictionEnabled,
    orbitPatches,
    maneuverNodes,
    targetBodyId,
    body,
    utBucket,
  ]);

  useEffect(() => {
    const canvas = predictionRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const hasMain = predictionSegments.length > 0;
    const hasManeuvers = maneuverSegments.some((s) => s.length > 0);
    if (!hasMain && !hasManeuvers) return;

    ctx.setTransform(...cameraTransform(camera, w, h));
    // Compensate stroke + dash for camera zoom so they stay visually consistent at any scale.
    const screenLineWidth = 1.5;
    const screenDash = 4;
    ctx.lineWidth = screenLineWidth / camera.zoom;
    ctx.setLineDash([screenDash / camera.zoom, screenDash / camera.zoom]);

    // Current-orbit prediction: amber, faded proportional to time from now.
    drawFadedSegments(ctx, predictionSegments, adjustedMap, [255, 180, 64]);

    // Planned maneuvers: cyan, drawn over the main prediction.
    for (const segments of maneuverSegments) {
      drawFadedSegments(ctx, segments, adjustedMap, [64, 200, 255]);
    }

    ctx.setLineDash([]);

    // SOI marker: predictGroundTrack stops at a referenceBody change, so the last sample is the ground point at the transition.
    if (encounterKind !== null) {
      let last: TrackSample | null = null;
      for (let i = predictionSegments.length - 1; i >= 0; i--) {
        const seg = predictionSegments[i];
        if (seg.length > 0) {
          last = seg[seg.length - 1];
          break;
        }
      }
      if (
        last !== null &&
        Number.isFinite(last.lat) &&
        Number.isFinite(last.lon)
      ) {
        const { x: ex, y: ey } = adjustedMap(
          WORLD_W,
          WORLD_H,
          last.lat,
          last.lon,
        );
        const r = 6 / camera.zoom;
        ctx.strokeStyle =
          encounterKind === "encounter"
            ? "rgba(64, 200, 255, 0.9)"
            : "rgba(255, 180, 64, 0.9)";
        ctx.lineWidth = 1.5 / camera.zoom;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner dot so the ring is legible even at low zoom.
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5 / camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Impact marker, in world space so it pans and zooms with the map.
    if (impactLat !== undefined && impactLon !== undefined) {
      const { x: ix, y: iy } = adjustedMap(
        WORLD_W,
        WORLD_H,
        impactLat,
        impactLon,
      );
      const crossSize = 6 / camera.zoom;
      ctx.strokeStyle = "rgba(255, 64, 64, 0.9)";
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.beginPath();
      ctx.moveTo(ix - crossSize, iy - crossSize);
      ctx.lineTo(ix + crossSize, iy + crossSize);
      ctx.moveTo(ix + crossSize, iy - crossSize);
      ctx.lineTo(ix - crossSize, iy + crossSize);
      ctx.stroke();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  useEffect(() => {
    const canvas = dataRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    // Only on the vessel's own body, and never with a NaN position.
    if (
      vesselOnThisBody &&
      lat !== undefined &&
      lon !== undefined &&
      Number.isFinite(lat) &&
      Number.isFinite(lon)
    ) {
      const { x: wx, y: wy } = adjustedMap(
        WORLD_W,
        WORLD_H,
        lat.magnitude,
        lon.magnitude,
      );
      const { x, y } = worldToScreen(wx, wy, camera, w, h);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = canvasColor(canvas, "--color-accent-fg", "#00ff88");
      ctx.fill();

      ctx.strokeStyle = "rgba(0,255,136,0.6)";
      ctx.lineWidth = 1;
      const cross = 8;
      ctx.beginPath();
      ctx.moveTo(x - cross, y);
      ctx.lineTo(x + cross, y);
      ctx.moveTo(x, y - cross);
      ctx.lineTo(x, y + cross);
      ctx.stroke();
    }
  }, [containerSize, camera, lat, lon, adjustedMap, vesselOnThisBody]);

  const displayName = body?.name ?? targetBodyId;

  // "NO SIGNAL" belongs to the global SignalLossIndicator banner, not this chip.
  const imagingStatus = useMemo<{
    label: string;
    variant: "on" | "off" | "warn";
  } | null>(() => {
    if (!body) return null;
    /* The readout altitude, not the trail's: "IMAGING" is a verdict about now. */
    if (altSeaReadout === undefined)
      return { label: "NO DATA", variant: "off" };
    const { min, max } = getImagingWindow(body);
    if (altSeaReadout < min) return { label: "TOO LOW", variant: "warn" };
    if (altSeaReadout > max) return { label: "TOO HIGH", variant: "warn" };
    return { label: "IMAGING", variant: "on" };
  }, [body, altSeaReadout]);

  // Too small to read the canvas: collapse to a lat/lon readout.
  const cols = w ?? 12;
  const rows = h ?? 18;
  const showMap = rows >= 6 && cols >= 6;
  const showImagingChip = showMap && cols >= 8;
  const showFollowToggle = showMap && cols >= 9;
  const showBodyLabel = cols >= 5;

  /**
   * What stands in for a position neither branch can draw, shared so the two
   * branches say the same thing: never reported and held-but-not-current are
   * different states to an operator.
   */
  const positionNotice =
    lat !== undefined && lon !== undefined
      ? undefined
      : positionStale
        ? "Position not current: marker withheld"
        : targetBodyId === undefined
          ? "Waiting for telemetry..."
          : "No position data";

  // `overlay` is null until the container has measured.
  const scope: MapViewScope = useMemo(
    () => ({ bodyName: displayName }),
    [displayName],
  );
  const baseLayerContext: MapBaseLayerContext | null = containerSize
    ? {
        bodyId: targetBodyId,
        width: containerSize.w,
        height: containerSize.h,
        augmentSettings,
        coverageGate,
        onLayer: onBaseLayer,
      }
    : null;
  const overlayContext: MapOverlayContext | null = containerSize
    ? {
        width: containerSize.w,
        height: containerSize.h,
        camera,
        worldW: WORLD_W,
        worldH: WORLD_H,
        bodyName: targetBodyId,
        bodyRadius: body?.radius,
        vesselLat: vesselOnThisBody ? lat?.magnitude : undefined,
        vesselLon: vesselOnThisBody ? lon?.magnitude : undefined,
        project: (projLat, projLon) => {
          const { x: wx, y: wy } = adjustedMap(
            WORLD_W,
            WORLD_H,
            projLat,
            projLon,
          );
          return worldToScreen(
            wx,
            wy,
            camera,
            containerSize.w,
            containerSize.h,
          );
        },
      }
    : null;

  if (!showMap) {
    return (
      <WidgetScopeProvider widget="map-view" scope={scope}>
        <Panel
          panelTitle="MAP VIEW"
          // The composed header renders the host-derived stream status.
          panelAside={
            showBodyLabel && displayName ? (
              <BodyLabel>{displayName}</BodyLabel>
            ) : undefined
          }
          fitToSize
          sections={
            <Section full>
              <CompactReadout>
                <CompactRow>
                  <CompactLabel>Lat</CompactLabel>
                  <CompactValue>
                    {lat === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={lat} decimals={2} />
                    )}
                  </CompactValue>
                </CompactRow>
                <CompactRow>
                  <CompactLabel>Lon</CompactLabel>
                  <CompactValue>
                    {lon === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={lon} decimals={2} />
                    )}
                  </CompactValue>
                </CompactRow>
                {altSeaReadout !== undefined && rows >= 5 && (
                  <CompactRow>
                    <CompactLabel>Alt</CompactLabel>
                    <CompactValue>
                      <Unit value={altitudeReading} />
                    </CompactValue>
                  </CompactRow>
                )}
                {positionNotice !== undefined && (
                  <CompactRow>
                    <ReadoutCaption>{positionNotice}</ReadoutCaption>
                  </CompactRow>
                )}
              </CompactReadout>
            </Section>
          }
        />
      </WidgetScopeProvider>
    );
  }

  // The augment badges stay beside the title; state and controls get their own row. No floating header: this much chrome would cover the map.
  const toolbar =
    (showBodyLabel && displayName) ||
    (showImagingChip && vesselOnThisBody && imagingStatus) ||
    (showFollowToggle && vesselOnThisBody) ? (
      <>
        {showBodyLabel && displayName && (
          <BodyLabel>
            {displayName}
            {bodyOverride ? " (pinned)" : ""}
          </BodyLabel>
        )}
        {showImagingChip && vesselOnThisBody && imagingStatus && (
          <ImagingChip $variant={imagingStatus.variant}>
            {imagingStatus.label}
          </ImagingChip>
        )}
        {showFollowToggle && vesselOnThisBody && (
          <Switch
            checked={viewMode === "follow"}
            onChange={(on) => setViewMode(on ? "follow" : "global")}
            label="Follow"
          />
        )}
        {showImagingChip && vesselOnThisBody && <OrbitalEventChips />}
      </>
    ) : undefined;

  return (
    <WidgetScopeProvider widget="map-view" scope={scope}>
      <Panel
        panelTitle="MAP VIEW"
        panelToolbar={toolbar}
        /* The sections seam sits under `MapSections`'s own divider. */
        panelSections={false}
        sections={[
          <Section key="map" fill>
            <MapBody>
              <MapFrame>
                <MapOuter ref={outerRef}>
                  <CanvasContainer
                    ref={interactionRef}
                    style={
                      containerSize
                        ? { width: containerSize.w, height: containerSize.h }
                        : undefined
                    }
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                  >
                    <BaseCanvas
                      ref={baseRef}
                      data-testid="map-view-base-canvas"
                    />
                    <OverlayCanvas ref={overlayRef} />
                    <PersistentDataCanvas ref={persistentDataRef} />
                    {/* A canvas has no inspectable content, so the drawn segment count and markers are exposed here. */}
                    <PredictionCanvas
                      ref={predictionRef}
                      data-prediction-segments={predictionSegments.length}
                      data-encounter-marker={encounterKind ?? undefined}
                      data-impact-marker={
                        impactLat !== undefined ? "" : undefined
                      }
                    />
                    <DataCanvas ref={dataRef} />
                    {positionNotice !== undefined && (
                      <NoSignal>{positionNotice}</NoSignal>
                    )}
                    {baseLayerContext && (
                      <AugmentSlot
                        name="map-view.base"
                        props={baseLayerContext}
                      />
                    )}
                    {getAugmentsForSlot("map-view.base")
                      .filter((a) => a.suppressesVanillaBase === true)
                      .map((a) => (
                        <VanillaSuppressionProbe
                          key={a.id}
                          augment={a}
                          onAvailableChange={onSuppressAvailabilityChange}
                        />
                      ))}
                    {overlayContext && (
                      <OverlayAugmentLayer>
                        <AugmentSlot
                          name="map-view.overlay"
                          props={overlayContext}
                        />
                      </OverlayAugmentLayer>
                    )}
                    {overlayContext && showPois && (
                      <MapPoiLayer
                        bodyId={targetBodyId}
                        project={overlayContext.project}
                        width={overlayContext.width}
                        height={overlayContext.height}
                      />
                    )}
                  </CanvasContainer>
                </MapOuter>
              </MapFrame>
            </MapBody>
          </Section>,
          /* Under the map, not over it: only the forward track is refused. */
          trajectoryWithheld && predictionEnabled && hasPatchChain ? (
            <Section key="withheld">
              <ReadoutCaption role="status">
                {trajectoryWithheldCopy(trajectoryWithheld).heading}: no
                predicted ground track
              </ReadoutCaption>
            </Section>
          ) : null,
          /* No frame caption: a ground track is always body-fixed. */
          <MapSections key="augments">
            <WidgetSections />
          </MapSections>,
        ]}
      />
    </WidgetScopeProvider>
  );
}

registerComponent<MapViewConfig>({
  id: "map-view",
  name: "Map View",
  description:
    "Equirectangular map of the current body with vessel position and trajectory trail. Pin any body, and extend with registered map-view augments (base surfaces, overlays, sections, POIs).",
  tags: ["telemetry"],
  defaultSize: { w: 12, h: 18 },
  minSize: { w: 3, h: 4 },
  component: MapViewComponent,
  configComponent: MapViewConfigComponent,
  // `vessel.orbit` is read by `OrbitalEventChips` inside this widget, so it is declared here.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {
    trajectoryLength: 2000,
    showPrediction: true,
  },
  actions: mapViewActions,
  augmentSlots: [
    "map-view.overlay",
    "map-view.sections",
    "map-view.base",
    "map-view.actions",
  ],
  pushable: true,
  requires: ["flight"],
});

export { MapViewComponent, VanillaSuppressionProbe };
