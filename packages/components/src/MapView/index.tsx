import type {
  ActionDefinition,
  ComponentProps,
  DataSourceRegistry,
  TrackSample,
} from "@gonogo/core";
import {
  getBody,
  getImagingWindow,
  latLonToMap,
  predictGroundTrack,
  registerComponent,
  splitOnLongitudeWrap,
  useActionInput,
  useDataValue,
} from "@gonogo/core";
import { useDataSchema, useScanAnomalies, useScanSatFogSync } from "@gonogo/data";
import { Panel, PanelTitle, Switch } from "@gonogo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataColor } from "../shared/dataPalette";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";
import {
  cameraTransform,
  fitCamera,
  followZoom,
  WORLD_H,
  WORLD_W,
  worldToScreen,
  zoomBounds,
} from "./camera";
import {
  BaseCanvas,
  BodyLabel,
  CanvasContainer,
  CompactLabel,
  CompactReadout,
  CompactRow,
  CompactValue,
  DataCanvas,
  Header,
  ImagingChip,
  MapOuter,
  NoSignal,
  OverlayCanvas,
  PersistentDataCanvas,
  PredictionCanvas,
  PredictionChip,
  TelemetryPanel,
  TelKey,
  TelRow,
  TelValue,
} from "./MapView.styles";
import { MapViewConfigComponent } from "./MapViewConfig";
import { quantiseUt } from "./predictionThrottle";
import type { MapViewConfig } from "./types";
import { useCamera } from "./useCamera";
import { useFogDisplayCanvas } from "./useFogMask";
import { useBiomeCanvas, useHeightCanvas } from "./useScanLayerCanvas";
import { useMapResize } from "./useMapResize";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";
import { useWorldCanvas } from "./useWorldCanvas";

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
 * Stroke a list of longitude-wrap-split segments with a fade that's
 * continuous across the whole list (rather than resetting per segment).
 * Caller is responsible for transform, lineWidth, and dash.
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

function MapViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<MapViewConfig>>) {
  const trajectoryLength = config?.trajectoryLength ?? 2000;
  const telemetryKeys = config?.telemetryKeys ?? [];
  const showTelemetry = telemetryKeys.length > 0;
  const showPrediction = config?.showPrediction ?? true;
  const baseLayer = config?.baseLayer ?? "altimetry";
  const showHeightShading = config?.showHeightShading ?? false;
  const showAnomalies = config?.showAnomalies ?? false;

  const schema = useDataSchema("data");
  const labelMap = new Map(schema.map((k) => [k.key, k.label]));

  const lat = useDataValue("data", "v.lat");
  const lon = useDataValue("data", "v.long");
  const altSea = useDataValue("data", "v.altitude");
  const bodyName = useDataValue("data", "v.body");
  const shipPitch = useDataValue("data", "n.pitch");
  const shipHeading = useDataValue("data", "n.heading");
  const q = useDataValue("data", "v.dynamicPressure");
  const mach = useDataValue("data", "v.mach");
  const speed = useDataValue("data", "v.surfaceSpeed");
  const vSpeed = useDataValue("data", "v.verticalSpeed");
  const orbitPatches = useDataValue("data", "o.orbitPatches");
  const maneuverNodes = useDataValue("data", "o.maneuverNodes");
  const universalTime = useDataValue("data", "t.universalTime");
  const impactLat = useDataValue("data", "land.predictedLat");
  const impactLon = useDataValue("data", "land.predictedLon");
  const physicsMode = useDataValue("data", "a.physicsMode");
  // SOI encounter / escape (-1 escape, 0 none, 1 encounter). Only the
  // marker draw cares about the sign; the chips component owns the body/time
  // readouts.
  const encounterExists = useDataValue("data", "o.encounterExists");
  // Principia (N-body) breaks patched-conic assumptions, so stock o.* and our
  // Keplerian propagator are both wrong. Suppress the prediction entirely and
  // show a chip. On Principia installs this field can briefly flap to
  // "patched_conics" during scene loads — we accept a short cosmetic window
  // where prediction is drawn before suppressing it; not worth the extra
  // state machine to debounce.
  const isNBody = physicsMode === "n_body";
  // Whether we should bother computing any prediction at all. Consumed by
  // both the current-orbit and maneuver memoisations and the chip overlay.
  const predictionEnabled = showPrediction && !isNBody;

  const targetBodyId = bodyName;
  const body = targetBodyId ? getBody(targetBodyId) : undefined;

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
    lat,
    lon,
    altSea,
    q,
    mach,
    speed,
    vSpeed,
    trajectoryLength,
  });

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<HTMLCanvasElement>(null);
  const persistentDataRef = useRef<HTMLCanvasElement>(null);
  const predictionRef = useRef<HTMLCanvasElement>(null);

  // SCANsat layer hooks. Declared up here (before the base-canvas
  // render effect) so the effect's dependency array can reference
  // them without TDZ. Each hook gates its own fetch on the toggle.
  useScanSatFogSync(body);
  const biomeDisplay = useBiomeCanvas(body, baseLayer === "biome");
  const heightDisplay = useHeightCanvas(body, showHeightShading);
  const anomalies = useScanAnomalies(showAnomalies ? body?.name : undefined);
  const fogDisplay = useFogDisplayCanvas(targetBodyId);

  // Per-body coordinate offsets — applied in both world canvas and screen space
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

  // ── Follow mode: drive camera from vessel position + speed ────────────────
  useEffect(() => {
    if (viewMode !== "follow" || lat === undefined || lon === undefined) return;
    const { x: wx, y: wy } = adjustedMap(WORLD_W, WORLD_H, lat, lon);
    setCamera({
      zoom: followZoom(speed ?? 0, baseZoom),
      panX: wx,
      panY: wy,
    });
  }, [viewMode, lat, lon, speed, adjustedMap, baseZoom, setCamera]);

  // ── Base layer: map texture + grid in world space via camera ──────────────
  // Texture is cached in a ref so camera changes don't trigger a reload
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
    ctx.fillStyle = "var(--color-surface-panel)";
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(...cameraTransform(camera, w, h));

    // Pick the base image: biome canvas when in biome mode and the
    // grid has decoded, otherwise the body's stock texture. The body-
    // colour wash is the last-resort fallback for bodies without a
    // texture loaded yet.
    const baseImage =
      baseLayer === "biome" && biomeDisplay.canvas
        ? biomeDisplay.canvas
        : textureImage;

    if (baseImage) {
      ctx.drawImage(baseImage, 0, 0, WORLD_W, WORLD_H);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    } else if (body?.color) {
      ctx.fillStyle = `${body.color}22`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    // Elevation shading rides on top of either base layer — opacity is
    // baked into the ramp colours so the underlying base shows through.
    if (showHeightShading && heightDisplay.canvas) {
      ctx.drawImage(heightDisplay.canvas, 0, 0, WORLD_W, WORLD_H);
    }

    // lineWidth compensates for zoom so grid lines remain 1 screen pixel
    ctx.strokeStyle = textureImage
      ? "rgba(255,255,255,0.05)"
      : "var(--color-surface-raised)";
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

    ctx.strokeStyle = textureImage
      ? "rgba(255,255,255,0.15)"
      : "var(--color-border-subtle)";
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
  }, [
    containerSize,
    camera,
    textureReady,
    body?.color,
    baseLayer,
    biomeDisplay.canvas,
    biomeDisplay.version,
    showHeightShading,
    heightDisplay.canvas,
    heightDisplay.version,
  ]);

  // ── Fog-of-war: driven exclusively by SCANsat ────────────────────────────
  // The per-vessel painter (paintFogFromBody / paintFogDisc) modelled
  // gonogo's own imaging FOV from lat/lon/altitude/heading. SCANsat
  // replaces that wholesale: scanner range gates + sub-vessel point are
  // KSP's own model, persisted into the save's SCANcontroller scenario
  // module, and the fork's scan.maskBitmap surfaces the resulting
  // coverage bitfield. The FogMaskCache stays (PeerJS sync + station
  // mirror still work through it); it's just now sourced from SCANsat
  // alone. Without SCANsat installed there is no fog source — MapView
  // shows the base body texture without an overlay.

  // fogDisplay.version is needed even though the canvas reference is stable:
  // the canvas contents are repainted in place as the fog mask mutates.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fogDisplay.version triggers redraw when canvas content changes
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(...cameraTransform(camera, w, h));
    if (fogDisplay.canvas) {
      ctx.drawImage(fogDisplay.canvas, 0, 0, WORLD_W, WORLD_H);
    }
    // Anomaly markers — only render the discovered ones (known = true).
    // `detail = true` parts get a brighter ring + label-ready hit area;
    // discovered-without-detail render dimmer. Undiscovered anomalies
    // don't appear at all (the player can't see what they haven't
    // found).
    if (showAnomalies && body && anomalies && anomalies.length > 0) {
      const r = Math.max(2, 4 / camera.zoom);
      const stroke = Math.max(1, 1.5 / camera.zoom);
      for (const a of anomalies) {
        if (!a.known) continue;
        const adjLat = a.latitude + (body.latitudeOffset ?? 0);
        const adjLon = a.longitude + (body.longitudeOffset ?? 0);
        const { x, y } = latLonToMap(adjLat, adjLon, WORLD_W, WORLD_H);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = a.detail
          ? "rgba(255, 220, 90, 0.95)"
          : "rgba(255, 220, 90, 0.55)";
        ctx.fill();
        ctx.strokeStyle = a.detail
          ? "rgba(255, 255, 200, 0.95)"
          : "rgba(255, 255, 200, 0.4)";
        ctx.lineWidth = stroke;
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [
    containerSize,
    camera,
    fogDisplay.canvas,
    fogDisplay.version,
    showAnomalies,
    anomalies,
    body,
  ]);

  // ── Trajectory layer: blit world canvas through camera ────────────────────
  // trajectoryCount is needed here even though worldCanvasRef is a ref:
  // the ref's identity is stable but its canvas content changes on each new point.
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
    ctx.setTransform(...cameraTransform(camera, w, h));
    ctx.drawImage(worldCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [containerSize, camera, trajectoryCount]);

  // ── Prediction: forward-propagated ground track from o.orbitPatches ───────
  // Kept as a memoised pure computation so the render effect only fires when
  // the sampled path actually changes. We *throttle* via `quantiseUt` so the
  // memo only invalidates once a second, not once per Telemachus tick (~4 Hz).
  // The orbit shape doesn't change between adjacent ticks; the body-rotation
  // calibration drifts by ~0.1° of longitude over a second, well below
  // perceptible at typical zoom levels.
  const utBucket = quantiseUt(universalTime, 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lat/lon/universalTime read inside, but invalidation gated on utBucket — see comment above
  const predictionSegments = useMemo<TrackSample[][]>(() => {
    if (!predictionEnabled) return [];
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
    // 1.5 × period shows the whole closed orbit plus a bit so the loop is
    // obvious. Capped at 1 Kerbin day (21600s) for absurdly long interplanetary
    // patches; MAX_TRACK_SAMPLES further bounds sample count.
    const horizon = Math.min(1.5 * firstForBody.period, 21_600);
    const samples = predictGroundTrack(
      orbitPatches,
      targetBodyId,
      body.radius,
      body.rotationPeriod,
      { ut: universalTime, lat, lon },
      horizon,
      10,
    );
    return splitOnLongitudeWrap(samples);
  }, [predictionEnabled, orbitPatches, targetBodyId, body, utBucket]);

  // Planned maneuvers: each node's `orbitPatches` is the post-burn trajectory.
  // We calibrate from the current orbit patches (they contain ref.ut) and
  // sample from the node's patches. Horizon uses the node's first-patch
  // period so near-maneuver orbits render without extending indefinitely.
  // Same `utBucket` throttle as the main prediction.
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
    // Capture past the outer guard so TS doesn't re-widen inside the map
    // callback below.
    const bodyRadius = body.radius;
    const rotPeriod = body.rotationPeriod;
    return maneuverNodes.map((node) => {
      const firstPatch = node.orbitPatches.find(
        (p) => p.referenceBody === targetBodyId,
      );
      if (!firstPatch) return [];
      // Horizon extends from ref.ut up through the maneuver and 1.5 × its
      // first post-burn period — enough to see the new orbit close up.
      const horizon = Math.min(
        node.UT - universalTime + 1.5 * firstPatch.period,
        21_600,
      );
      if (horizon <= 0) return [];
      const samples = predictGroundTrack(
        node.orbitPatches,
        targetBodyId,
        bodyRadius,
        rotPeriod,
        { ut: universalTime, lat, lon },
        horizon,
        10,
        orbitPatches,
      );
      return splitOnLongitudeWrap(samples);
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
    // Compensate stroke + dash for camera zoom so they stay visually
    // consistent at any scale.
    const screenLineWidth = 1.5;
    const screenDash = 4;
    ctx.lineWidth = screenLineWidth / camera.zoom;
    ctx.setLineDash([screenDash / camera.zoom, screenDash / camera.zoom]);

    // Current-orbit prediction — amber, faded proportional to time from now.
    drawFadedSegments(ctx, predictionSegments, adjustedMap, [255, 180, 64]);

    // Planned maneuvers — cyan, same fade. Drawn on top of the main
    // prediction so upcoming burns read as "future plan".
    for (const segments of maneuverSegments) {
      drawFadedSegments(ctx, segments, adjustedMap, [64, 200, 255]);
    }

    ctx.setLineDash([]);

    // SOI transition marker — the last sample of the prediction is the
    // ground position just before the patch ends, which is exactly the
    // ground track at SOI change (predictGroundTrack terminates on
    // patch.referenceBody mismatch). Only renders when `o.encounterExists`
    // is non-zero; -1 = escape (orange ring), 1 = encounter (green ring).
    // Drawn in world space so it pans/zooms with the map.
    if (typeof encounterExists === "number" && encounterExists !== 0) {
      let last: TrackSample | null = null;
      for (let i = predictionSegments.length - 1; i >= 0; i--) {
        const seg = predictionSegments[i];
        if (seg.length > 0) {
          last = seg[seg.length - 1];
          break;
        }
      }
      if (last !== null) {
        const { x: ex, y: ey } = adjustedMap(
          WORLD_W,
          WORLD_H,
          last.lat,
          last.lon,
        );
        const r = 6 / camera.zoom;
        ctx.strokeStyle =
          encounterExists === 1
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

    // Impact marker — Telemachus's own landing math. (0, 0) is the
    // "no prediction" sentinel; skip it. Rendered in world space so the
    // marker pans/zooms with the map.
    if (
      impactLat !== undefined &&
      impactLon !== undefined &&
      Number.isFinite(impactLat) &&
      Number.isFinite(impactLon) &&
      !(impactLat === 0 && impactLon === 0)
    ) {
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
    encounterExists,
  ]);

  // ── Data layer: vessel dot in world → screen space ────────────────────────
  useEffect(() => {
    const canvas = dataRef.current;
    if (!canvas || !containerSize) return;
    const { w, h } = containerSize;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    if (lat !== undefined && lon !== undefined) {
      const { x: wx, y: wy } = adjustedMap(WORLD_W, WORLD_H, lat, lon);
      const { x, y } = worldToScreen(wx, wy, camera, w, h);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "var(--color-accent-fg)";
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
  }, [containerSize, camera, lat, lon, adjustedMap]);

  const displayName = body?.name ?? targetBodyId;

  // "NO SIGNAL" state lives in the global SignalLossIndicator banner;
  // keeping it off this chip avoids double-reporting (and would be
  // misleading now that fog still paints during blackout — see useFogPainter).
  const imagingStatus = useMemo<{
    label: string;
    variant: "on" | "off" | "warn";
  } | null>(() => {
    if (!body) return null;
    if (altSea === undefined) return { label: "NO DATA", variant: "off" };
    const { min, max } = getImagingWindow(body);
    if (altSea < min) return { label: "TOO LOW", variant: "warn" };
    if (altSea > max) return { label: "TOO HIGH", variant: "warn" };
    return { label: "IMAGING", variant: "on" };
  }, [body, altSea]);

  // Selective rendering — at small sizes the canvas isn't readable, so
  // collapse to a lat/lon text readout. Header chrome (imaging chip, follow
  // toggle) drops at narrow widths.
  const cols = w ?? 12;
  const rows = h ?? 18;
  const showMap = rows >= 6 && cols >= 6;
  const showImagingChip = showMap && cols >= 8;
  const showFollowToggle = showMap && cols >= 9;
  const showBodyLabel = cols >= 5;

  if (!showMap) {
    return (
      <Panel>
        <Header>
          <PanelTitle>MAP VIEW</PanelTitle>
          {showBodyLabel && displayName && <BodyLabel>{displayName}</BodyLabel>}
        </Header>
        <CompactReadout>
          <CompactRow>
            <CompactLabel>Lat</CompactLabel>
            <CompactValue>
              {lat === undefined ? "—" : `${lat.toFixed(3)}°`}
            </CompactValue>
          </CompactRow>
          <CompactRow>
            <CompactLabel>Lon</CompactLabel>
            <CompactValue>
              {lon === undefined ? "—" : `${lon.toFixed(3)}°`}
            </CompactValue>
          </CompactRow>
          {altSea !== undefined && rows >= 5 && (
            <CompactRow>
              <CompactLabel>Alt</CompactLabel>
              <CompactValue>{`${(altSea / 1000).toFixed(1)} km`}</CompactValue>
            </CompactRow>
          )}
        </CompactReadout>
      </Panel>
    );
  }

  return (
    <Panel>
      <Header>
        <PanelTitle>MAP VIEW</PanelTitle>
        {showBodyLabel && displayName && <BodyLabel>{displayName}</BodyLabel>}
        {showImagingChip && imagingStatus && (
          <ImagingChip $variant={imagingStatus.variant}>
            {imagingStatus.label}
          </ImagingChip>
        )}
        {showFollowToggle && (
          <Switch
            checked={viewMode === "follow"}
            onChange={(on) => setViewMode(on ? "follow" : "global")}
            label="Follow"
          />
        )}
        {showImagingChip && <OrbitalEventChips />}
      </Header>

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
          <BaseCanvas ref={baseRef} />
          <OverlayCanvas ref={overlayRef} />
          <PersistentDataCanvas ref={persistentDataRef} />
          <PredictionCanvas ref={predictionRef} />
          <DataCanvas ref={dataRef} />
          {(lat === undefined || lon === undefined) && (
            <NoSignal>
              {targetBodyId === undefined
                ? "Waiting for telemetry…"
                : "No position data"}
            </NoSignal>
          )}
          {showPrediction && isNBody && (
            <PredictionChip title="Principia's N-body integrator invalidates patched-conic prediction.">
              Prediction unavailable · N-body
            </PredictionChip>
          )}
        </CanvasContainer>
      </MapOuter>

      {showTelemetry && (
        <TelemetryPanel>
          {telemetryKeys.map((key, idx) => (
            <TelemetryRow
              key={key}
              dataKey={key}
              label={labelMap.get(key) ?? key}
              colorIndex={idx}
            />
          ))}
        </TelemetryPanel>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Telemetry row — own component so useDataValue can be called per key
// ---------------------------------------------------------------------------

function formatTelValue(value: unknown): string {
  if (value === undefined) return "—";
  const n = Number(value);
  if (!Number.isNaN(n) && typeof value !== "boolean") return n.toFixed(2);
  // Explicit type-switch so `String(value)` can never fall onto Object's
  // default "[object Object]" (or throw on a Symbol). Anything we don't
  // have a sensible readout for becomes "—".
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return "—";
}

function TelemetryRow({
  dataKey,
  label,
  colorIndex,
}: Readonly<{
  dataKey: string;
  label: string;
  colorIndex: number;
}>) {
  const value = useDataValue(
    "data",
    dataKey as keyof DataSourceRegistry["data"],
  );
  const colour = dataColor(colorIndex);
  return (
    <TelRow>
      <TelKey $colour={colour}>{label}</TelKey>
      <TelValue $colour={colour}>{formatTelValue(value)}</TelValue>
    </TelRow>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerComponent<MapViewConfig>({
  id: "map-view",
  name: "Map View",
  description:
    "Equirectangular map of the current body with vessel position and trajectory trail.",
  tags: ["telemetry"],
  defaultSize: { w: 12, h: 18 },
  minSize: { w: 3, h: 4 },
  component: MapViewComponent,
  configComponent: MapViewConfigComponent,
  dataRequirements: [
    "v.lat",
    "v.long",
    "v.altitude",
    "v.body",
    "o.orbitPatches",
    "o.encounterExists",
    "o.encounterBody",
    "o.encounterTime",
    "o.nextApsisType",
    "o.timeToNextApsis",
    "t.universalTime",
    "n.pitch",
    "n.heading",
  ],
  defaultConfig: {
    trajectoryLength: 2000,
    showPrediction: true,
  },
  actions: mapViewActions,
  pushable: true,
  requires: ["flight"],
});

export { MapViewComponent };
