import type {
  ActionDefinition,
  AnyAugment,
  ComponentProps,
  DataSourceRegistry,
  TrackSample,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getAugmentsForSlot,
  getBody,
  getImagingWindow,
  latLonToMap,
  predictGroundTrack,
  registerComponent,
  splitOnLongitudeWrap,
  useActionInput,
  useAugmentAvailable,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useDataSchema } from "@ksp-gonogo/data";
import {
  useStream,
  useViewUt,
  type VesselManeuverLegacyState,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { Panel, PanelTitle, StreamStatusBadge, Switch } from "@ksp-gonogo/ui";
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
  Header,
  ImagingChip,
  MapBody,
  MapOuter,
  MapSections,
  NoSignal,
  OverlayAugmentLayer,
  OverlayCanvas,
  PersistentDataCanvas,
  PredictionCanvas,
  TelemetryPanel,
  TelKey,
  TelRow,
  TelValue,
} from "./MapView.styles";
import { MapViewConfigComponent } from "./MapViewConfig";
import { groupBaseLayersByUplink } from "./orderBaseLayers";
import { type BaseSurfaceLayer, paintBaseSurface } from "./paintBaseSurface";
import { quantiseUt } from "./predictionThrottle";
import type { MapViewConfig } from "./types";
import { useCamera } from "./useCamera";
import { type CoverageGate, useCoverageGate } from "./useCoverageGate";
import { useMapResize } from "./useMapResize";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";
import { useWorldCanvas } from "./useWorldCanvas";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";
// Side-effect only — registers the vanilla KSC/launch-site/contract-target
// POI provider (T-POI-6) so MapPoiLayer below has something to render out
// of the box. Co-located with MapView per that file's own doc comment.
import "./vanillaPoiProvider";

/**
 * Resolve a CSS custom property to a concrete colour for use on a `<canvas>`
 * 2D context, which (unlike the DOM) cannot resolve `var(--...)` and silently
 * paints black when handed one. Reads the computed value off the canvas
 * element so theme switches are respected; falls back to the token's default
 * if the property isn't set (e.g. before the theme stylesheet is applied).
 */
function canvasColor(
  el: HTMLElement,
  varName: string,
  fallback: string,
): string {
  const v = getComputedStyle(el).getPropertyValue(varName).trim();
  return v || fallback;
}

// ---------------------------------------------------------------------------
// Augment slots (Uplink architecture). MapView is a HOST that exposes
// five slots; no first-party augment fills them here, so
// each renders nothing until an Uplink registers an augment into it. This is
// THE HARD CASE for slot design: the overlay must draw in
// the map's own coordinate space, so `map-view.overlay` passes the live
// equirectangular projection down as slot props. Composable /
// layered by priority — an Uplink's own scan-layer, commlink, and
// trajectory overlays all route HERE. `map-view.sections` is a
// below-content panel slot (mirrors `objectives.sections`/
// `power-systems.sections`); `map-view.actions` is a header control-row
// slot (mirrors `system-view.actions`) for quick per-layer toggles; and
// `map-view.base` is the STACKABLE REPLACE slot for the map's base
// surface — many augments may draw, composited in order — see each
// interface's own doc comment below.
// ---------------------------------------------------------------------------

/**
 * Props for `map-view.overlay` — an OVERLAY slot, rendered in a
 * layer absolutely positioned over the map canvases. The base map draws in
 * screen pixels via a per-body coordinate offset (equirectangular
 * `latLonToMap`) followed by the live pan/zoom camera. An overlay augment
 * receives that full chain as `project`, so it can place markers on the exact
 * same pixels the base map paints — without re-deriving the offset / camera
 * maths. The raw pieces (`camera`, `worldW`/`worldH`, body identity) are passed
 * alongside for augments that need to build their own transform (e.g. a WebGL
 * layer) rather than call `project` per point.
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
  /**
   * Project geographic lat/lon (degrees) to a pixel coordinate in the overlay
   * layer's own space — the exact chain the base map draws with (per-body
   * offset + camera), so an overlay augment (commlink, trajectory, custom scan
   * layer) lands on the same pixels.
   */
  project: (lat: number, lon: number) => { x: number; y: number };
  /**
   * The active vessel's RAW (unadjusted — no `body.latitudeOffset`/
   * `longitudeOffset` baked in) lat/lon, for great-circle distance/bearing
   * ranking an overlay augment might want (e.g. anomaly proximity).
   * `undefined` when there's no position fix yet, or the mapped body
   * diverges from the vessel's body (a `bodyOverride` pinned elsewhere) —
   * matching the vessel-marker suppression rule the base map itself
   * applies.
   */
  vesselLat: number | undefined;
  vesselLon: number | undefined;
}

/**
 * Props for `map-view.badges` — the widget's BROAD escape-hatch slot
 * for composable badges, rendered in the header next to the title. Badge
 * augments read their own Topics via hooks, so the only context passed down is
 * the mapped body name for labelling.
 */
export interface MapBadgesContext {
  bodyName: string | undefined;
}

/**
 * Props for `map-view.sections` — a below-content panel slot, composed
 * additively by priority exactly like `map-view.overlay` and the
 * already-established `objectives.sections`/`power-systems.sections`
 * pattern. One panel per registered augment, rendered below the map canvas.
 */
export interface MapSectionsContext {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyName: string | undefined;
  /**
   * Per-namespace augment settings, keyed by augment id — the same
   * namespacing `getAugmentSettings` uses. Threaded through now so the
   * slot contract is stable; the read-back loop that resolves real
   * per-instance values from the widget's saved config lands in a later
   * task, so this is always `undefined` until then.
   */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
}

/**
 * Props for `map-view.base` — the STACKABLE REPLACE slot for the map's base
 * surface. Any number of registered augments may fill it; each decides for
 * itself (against its OWN `augmentSettings[itsOwnId]?.show`, and its own
 * data readiness) whether it currently has anything to paint. Like the old
 * single-pick shape, an augment filling this slot renders no JSX onto the
 * page — it hands back a canvas via `onLayer`, keyed by its OWN id (so
 * multiple augments calling `onLayer` concurrently don't clobber one
 * another). MapView composites every currently-supplied canvas in draw
 * order (see orderBaseLayers.ts), on top of its own stock-texture paint —
 * UNLESS some registered augment in this slot declares
 * `suppressesVanillaBase` (see augments.ts's `AugmentDefinition`), in which
 * case the stock texture is skipped outright, independent of which layers
 * (if any) are currently active. See paintBaseSurface.ts for the full
 * compositing rationale, including the "all layers off stays black" case.
 */
export interface MapBaseLayerContext {
  /** The mapped body (may diverge from the active vessel under a pin). */
  bodyId: string | undefined;
  width: number;
  height: number;
  /** Per-namespace augment settings — see `MapSectionsContext`'s doc
   *  comment; same shape, same "undefined until the read-back loop lands"
   *  caveat. An augment reads its OWN `augmentSettings[itsOwnId]?.show`
   *  (default true when unset) to decide whether it currently contributes
   *  a layer. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /** The paint-gate (T4) for this body — the augment samples this per
   *  output tile while drawing its own surface. `hasAnySource: false`
   *  means "paint fully open," not "paint nothing." */
  coverageGate: CoverageGate;
  /**
   * Called by the augment whenever it has a fresh canvas to contribute (or
   * `null` to withdraw one, e.g. toggled off). MUST pass the augment's OWN
   * id as the first argument — MapView keys its per-layer canvas store by
   * it, since (unlike the old single-pick shape) more than one augment may
   * hold a canvas at once. Anything a layer leaves transparent falls
   * through to whatever paints beneath it (another layer, the stock
   * texture, or the dark panel fill) rather than being forced opaque.
   */
  onLayer: (
    id: string,
    canvas: HTMLCanvasElement | null,
    version: number,
  ) => void;
}

/**
 * Props for `map-view.actions` — a header control-row slot (mirrors
 * `system-view.actions`) for quick per-layer toggles, alongside the
 * generic settings-panel checkboxes `AugmentSettingsPanel` already renders.
 * Unlike `system-view.actions` (which takes no props — its own toggles are
 * dashboard-instance-wide, not per-widget), MapView can have multiple
 * instances (different `bodyOverride` pins), so this slot threads the
 * CURRENT widget instance's own settings down and a way to persist a change
 * back into THAT instance's saved config — the same `augmentSettings[id]`
 * storage `map-view.base`/`map-view.sections` read and the settings-panel
 * Switch writes, so a quick toggle here and the settings-panel checkbox
 * always agree (spec: one source of truth, two surfaces).
 */
export interface MapActionsContext {
  /** Per-namespace augment settings — same shape/caveat as
   *  `MapSectionsContext`'s own field. A read-only snapshot of this widget
   *  instance's current saved values. */
  augmentSettings: Record<string, Record<string, unknown>> | undefined;
  /**
   * Persists ONE augment's `show` setting into this widget instance's own
   * config. A no-op when the widget isn't hosted by something that wired
   * up `onConfigChange` (e.g. an isolated render in a test).
   */
  setAugmentShow: (augmentId: string, show: boolean) => void;
}

// Co-located declaration-merge of this widget's slot ids → their props. Kept
// next to the widget (not in a central registry file) so parallel slot work
// on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "map-view.overlay": MapOverlayContext;
    "map-view.badges": MapBadgesContext;
    "map-view.sections": MapSectionsContext;
    "map-view.base": MapBaseLayerContext;
    "map-view.actions": MapActionsContext;
  }
}

// The facade-sealed-client copy of this merge (needed so
// `SlotProps<"map-view.*">` resolves precisely for a client that doesn't
// import `@ksp-gonogo/components`) lives in `mod/sitrep-sdk/src/api/
// slots.ts`, not a second `declare module "@ksp-gonogo/sitrep-sdk"` block
// here — see that module's header comment for why a same-file block can't
// reach a FOREIGN sealed client's compiled program
// (docs/superpowers/plans/2026-07-19-facade-sealing.md §2.3).

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

/**
 * Reports one `map-view.base` augment's live Domain availability up to
 * MapView, via `useAugmentAvailable` — the SAME gate `<AugmentSlot>` itself
 * applies before ever rendering that augment's component. Isolated into its
 * own component (mirrors `AugmentSlot.tsx`'s own `AugmentEntry`) so the
 * `useTelemetry` hook underneath has a stable position per augment
 * regardless of how many candidates are registered or how the set changes.
 * Renders nothing — this exists purely to feed
 * `suppressionAvailabilityRef`/`onSuppressAvailabilityChange` in
 * `MapViewComponent`, decoupled from whether the augment currently has
 * anything to paint.
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
    // Drop this augment's contribution on unmount (e.g. deregistered, or
    // the collapsed-view branch stops rendering this probe entirely) —
    // mirrors the onLayer cleanup discussion elsewhere in this file.
    return () => onAvailableChange(augment.id, false);
  }, [augment.id, available]);
  return null;
}

function MapViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<MapViewConfig>>) {
  const trajectoryLength = config?.trajectoryLength ?? 2000;
  const telemetryKeys = config?.telemetryKeys ?? [];
  const showTelemetry = telemetryKeys.length > 0;
  const showPrediction = config?.showPrediction ?? true;
  const bodyOverride = config?.bodyOverride;
  // Vanilla POIs (KSC, contract targets) are always-relevant reference
  // points, not an opt-in extension-shaped feature — default on (T-POI-7).
  const showPois = config?.showPois ?? true;

  const schema = useDataSchema("data");
  const labelMap = new Map(schema.map((k) => [k.key, k.label]));

  // Vessel kinematics read straight off the stream: raw `vessel.flight.*`
  // fields for the surface-frame measurements, and the client-derived
  // `vessel.state` channel for the quality-picked altitude, the index→name
  // body label, the reshaped orbit-patch chain, the encounter sign, and the
  // ballistic impact point. `vessel.maneuver.legacy` carries the post-burn
  // node trajectories reshaped into the legacy `o.maneuverNodes` shape.
  const flight = useTelemetry("vessel.flight");
  const vesselState = useStream<VesselState>("vessel.state");
  const lat = flight?.latitude;
  const lon = flight?.longitude;
  const altSea = vesselState?.altitudeAsl ?? undefined;
  const bodyName = vesselState?.parentBodyName ?? undefined;
  const q = flight?.dynamicPressureKPa;
  const mach = flight?.mach;
  const speed = flight?.surfaceSpeed;
  const vSpeed = flight?.verticalSpeed;
  const orbitPatches = vesselState?.orbitPatches;
  const maneuverNodes = useStream<VesselManeuverLegacyState>(
    "vessel.maneuver.legacy",
  )?.nodes;
  // t.universalTime is dropped as a data key — it was never a stream, it IS
  // the SDK view-UT the propagation is evaluated at, so read that directly.
  const universalTime = useViewUt();
  const impactLat = vesselState?.landingPredictedLat ?? undefined;
  const impactLon = vesselState?.landingPredictedLon ?? undefined;
  // SOI encounter / escape (-1 escape, 0 none, 1 encounter). Only the
  // marker draw cares about the sign; the chips component owns the body/time
  // readouts.
  const encounterExists = vesselState?.encounterExists;
  // Connectivity indicator, still sourced off the legacy `DataSource` status
  // channel (`v.lat` is representative of the widget's stream reads). The
  // per-key `TelemetryRow` readouts remain unmapped — `mapTopic` has no
  // entry for them, so those `useDataValue` reads fall back to legacy
  // automatically.
  const streamStatus = useDataStreamStatus("data", "v.lat");
  // Whether we should bother computing any prediction at all. Consumed by
  // both the current-orbit and maneuver memoisations and the chip overlay.
  const predictionEnabled = showPrediction;

  // The body picker (config.bodyOverride) decouples MapView from the
  // active vessel's body so the operator can inspect ANY body's base
  // layer and augments while orbiting elsewhere. Unset (the default)
  // follows v.body.
  const targetBodyId = bodyOverride ?? bodyName;
  const body = targetBodyId ? getBody(targetBodyId) : undefined;
  // True when the map is showing the active vessel's body — i.e. there's
  // no override, OR the override happens to equal the vessel's body. When
  // false (an override DIVERGES from the vessel's body), the
  // vessel-relative draws (marker, trail, prediction, anomaly distances)
  // and the follow chrome are suppressed — plotting a Kerbin craft onto
  // the Mun map would be misleading. With no override set, behaviour is
  // unchanged from before the picker existed.
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

  // The map-view.base slot's contributed surfaces — stackable, so keyed by
  // each contributing augment's OWN id rather than a single ref (the old
  // single-pick shape's assumption that at most one augment ever holds
  // this no longer applies; see MapBaseLayerContext's doc comment). A ref
  // (not state) because it's mutated on every `onLayer` call and read only
  // inside the imperative paint effect below — `baseLayerVersion` is the
  // state that actually triggers a redraw.
  const baseLayerCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(
    new Map(),
  );
  const [baseLayerVersion, setBaseLayerVersion] = useState(0);
  const onBaseLayer = useCallback(
    (id: string, canvas: HTMLCanvasElement | null, _version: number) => {
      if (canvas) baseLayerCanvasesRef.current.set(id, canvas);
      else baseLayerCanvasesRef.current.delete(id);
      // Bump MapView's OWN counter rather than forwarding the caller's
      // `_version` into state directly: with a single contributor that
      // number (typically `Date.now()`) was fine as a change-marker, but
      // with several augments potentially calling `onLayer` within the
      // same millisecond, two DIFFERENT augments could hand back an
      // identical value — React would then skip the re-render for the
      // second call since the state "changed" to the same number twice.
      // An unconditional increment can't collide that way.
      setBaseLayerVersion((v) => v + 1);
    },
    [],
  );

  // Live Domain-availability per `map-view.base` augment that declares
  // `suppressesVanillaBase` — tracked independently of whether that augment
  // currently has a canvas to contribute (per-layer `show` and data
  // readiness are separate concerns; see paintTile.ts). Fed by
  // `VanillaSuppressionProbe` below, one per candidate augment, using the
  // SAME `useAugmentAvailable` gate `<AugmentSlot>` itself applies before
  // ever rendering that augment's component — registry presence alone
  // (an unconditionally-bundled client package) is NOT the same as the
  // Domain actually being live (regression fixed 2026-07-20, see
  // vanillaSuppression.ts's header comment). Reuses `baseLayerVersion` to
  // trigger a repaint since both signals feed the same paint effect.
  const suppressionAvailabilityRef = useRef<Map<string, boolean>>(new Map());
  const onSuppressAvailabilityChange = useCallback(
    (id: string, available: boolean) => {
      if (available) suppressionAvailabilityRef.current.set(id, true);
      else suppressionAvailabilityRef.current.delete(id);
      setBaseLayerVersion((v) => v + 1);
    },
    [],
  );

  // Per-namespace augment settings for map-view.base/map-view.sections,
  // keyed by augment id — the same namespacing `getAugmentSettings` uses.
  // Read straight off this widget's saved config, populated by
  // `AugmentSettingsPanel` in `MapViewConfig.tsx`. `undefined` when nothing's
  // been saved yet — every consumer (useCoverageGate, an augment's own
  // settings) already treats that as "no overrides".
  const augmentSettings: Record<string, Record<string, unknown>> | undefined =
    config?.augmentSettings;

  // Read/write half of `map-view.actions`'s quick per-layer toggles (spec:
  // the action and the settings-panel checkbox read/write the SAME
  // `augmentSettings[id].show` — one source of truth, two surfaces). Mirrors
  // OrbitView's own `onConfigChange?.({ ...config, ... })` inline-persist
  // pattern; a no-op when nothing wired up `onConfigChange` (e.g. an
  // isolated test render).
  const setAugmentShow = useCallback(
    (augmentId: string, show: boolean) => {
      onConfigChange?.({
        ...config,
        augmentSettings: {
          ...augmentSettings,
          [augmentId]: { ...augmentSettings?.[augmentId], show },
        },
      });
    },
    [config, augmentSettings, onConfigChange],
  );

  // T4's paint-gate — a mod-agnostic map-view.base augment samples this
  // per output tile while drawing its own surface (settled model: zero
  // registered sources means "paint fully open," not "paint nothing").
  const coverageGate = useCoverageGate(targetBodyId, augmentSettings);

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

    // Base surface. `map-view.base` is STACKABLE — every registered
    // augment's currently-active canvas composites in draw order (grouped
    // by Uplink; see orderBaseLayers.ts), on top of the stock texture.
    // Vanilla suppression is a SEPARATE, declarative decision: any
    // registered augment declaring `suppressesVanillaBase` skips the
    // stock-texture paint outright, even if every layer is currently
    // toggled off — see paintBaseSurface.ts for that rationale, including
    // why "all layers off" must stay black rather than falling back to the
    // stock texture. But suppression must ALSO respect Domain availability
    // exactly like rendering does — a registered augment whose Domain isn't
    // live yet (or ever) must NOT suppress; see vanillaSuppression.ts's
    // header comment for the regression this guards against.
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

    // lineWidth compensates for zoom so grid lines remain 1 screen pixel.
    // A painted base surface — stock texture OR at least one active
    // replacement layer — takes the light grid; a bare/washed (or fully
    // suppressed-and-empty) canvas takes the dark one.
    ctx.strokeStyle =
      textureImage || orderedLayers.length > 0
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

    ctx.strokeStyle = textureImage
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

  // ── Fog-of-war: paint-gate, not a drawn overlay ──────────────────────────
  // The per-vessel painter (paintFogFromBody / paintFogDisc) modelled
  // gonogo's own imaging FOV from lat/lon/altitude/heading. A mod's own
  // reveal-source model replaces that wholesale — scanner range gates,
  // persisted coverage, etc. are that mod's own concern. There is no
  // separate dark overlay canvas drawn on top of the map anymore (settled
  // model) — `coverageGate` (T4, above) is handed to whichever
  // `map-view.base` augment is active so IT can gate its own per-tile
  // paint. This overlay canvas is left entirely for augments that draw ON
  // TOP of the base surface via the `map-view.overlay` slot below.
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
    // The trajectory trail is the active vessel's track. When a
    // bodyOverride maps a body the vessel isn't at, suppress it — the
    // trail's lat/lon would be projected through the wrong body's frame.
    if (vesselOnThisBody) {
      ctx.setTransform(...cameraTransform(camera, w, h));
      ctx.drawImage(worldCanvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }, [containerSize, camera, trajectoryCount, vesselOnThisBody]);

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

    // The vessel marker is only meaningful when the mapped body is the
    // one the vessel is at — under a divergent bodyOverride, suppress it.
    if (vesselOnThisBody && lat !== undefined && lon !== undefined) {
      const { x: wx, y: wy } = adjustedMap(WORLD_W, WORLD_H, lat, lon);
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

  // Slot props. `badges` carries just the mapped body name for
  // labelling; `overlay` carries the live equirectangular projection so an
  // augment can draw in the map's own pixel space — plus the vessel's raw
  // position, so an augment can do its own distance/bearing ranking
  // against it. `overlay` is null until the container has measured — the
  // layer only mounts once there's a pixel-sized map beneath it.
  const badgesContext: MapBadgesContext = { bodyName: displayName };
  const sectionsContext: MapSectionsContext = {
    bodyName: displayName,
    augmentSettings,
  };
  const actionsContext: MapActionsContext = { augmentSettings, setAugmentShow };
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
        vesselLat: vesselOnThisBody ? lat : undefined,
        vesselLon: vesselOnThisBody ? lon : undefined,
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
      <Panel>
        <Header>
          <PanelTitle>MAP VIEW</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
          {showBodyLabel && displayName && <BodyLabel>{displayName}</BodyLabel>}
        </Header>
        <CompactReadout>
          <CompactRow>
            <CompactLabel>Lat</CompactLabel>
            <CompactValue>
              {lat === undefined ? "—" : `${lat.toFixed(2)}°`}
            </CompactValue>
          </CompactRow>
          <CompactRow>
            <CompactLabel>Lon</CompactLabel>
            <CompactValue>
              {lon === undefined ? "—" : `${lon.toFixed(2)}°`}
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
        <AugmentSlot name="map-view.badges" props={badgesContext} />
        <AugmentSlot name="map-view.actions" props={actionsContext} />
        <StreamStatusBadge status={streamStatus} />
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
      </Header>

      <MapBody>
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
            <BaseCanvas ref={baseRef} data-testid="map-view-base-canvas" />
            <OverlayCanvas ref={overlayRef} />
            <PersistentDataCanvas ref={persistentDataRef} />
            <PredictionCanvas ref={predictionRef} />
            <DataCanvas ref={dataRef} />
            {(lat === undefined || lon === undefined) && (
              <NoSignal>
                {targetBodyId === undefined
                  ? "Waiting for telemetry..."
                  : "No position data"}
              </NoSignal>
            )}
            {baseLayerContext && (
              <AugmentSlot name="map-view.base" props={baseLayerContext} />
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
                <AugmentSlot name="map-view.overlay" props={overlayContext} />
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
      </MapBody>

      <MapSections>
        <AugmentSlot name="map-view.sections" props={sectionsContext} />
      </MapSections>

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
  const value = useTelemetry(
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
    "Equirectangular map of the current body with vessel position and trajectory trail. Pin any body, and extend with registered map-view augments (base surfaces, overlays, sections, POIs).",
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
    "n.pitch",
    "n.heading",
  ],
  defaultConfig: {
    trajectoryLength: 2000,
    showPrediction: true,
  },
  actions: mapViewActions,
  augmentSlots: [
    "map-view.overlay",
    "map-view.badges",
    "map-view.sections",
    "map-view.base",
    "map-view.actions",
  ],
  pushable: true,
  requires: ["flight"],
});

export { MapViewComponent, VanillaSuppressionProbe };
