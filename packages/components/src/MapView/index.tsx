import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  getImagingWindow,
  latLonToMap,
  registerComponent,
} from "@ksp-gonogo/core";
import { Switch } from "@ksp-gonogo/ui";
import {
  Panel,
  ReadoutCaption,
  Section,
  WidgetScopeProvider,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo } from "react";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";
import { trajectoryWithheldCopy } from "../shared/trajectoryWithheld";
import { mapViewActions, useMapViewActions } from "./actions";
import { CompactMapView } from "./CompactMapView";
import { followZoom, WORLD_H, WORLD_W, worldToScreen } from "./camera";
import { MapPoiLayer } from "./MapPoiLayer";
import {
  BaseCanvas,
  BodyLabel,
  CanvasContainer,
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
import type {
  MapBaseLayerContext,
  MapOverlayContext,
  MapViewScope,
} from "./slots";
import type { MapViewConfig } from "./types";
import { useBaseLayers } from "./useBaseLayers";
import { useCamera } from "./useCamera";
import { useCoverageGate } from "./useCoverageGate";
import { useGroundTrackPrediction } from "./useGroundTrackPrediction";
import { useMapPainting } from "./useMapPainting";
import { useMapResize } from "./useMapResize";
import { useMapTelemetry } from "./useMapTelemetry";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";
import { useWorldCanvas } from "./useWorldCanvas";
import { VanillaSuppressionProbe } from "./VanillaSuppressionProbe";
// Side-effect only: registers the vanilla POI provider MapPoiLayer renders.
import "./vanillaPoiProvider";

export type { MapViewActions } from "./actions";
export type {
  MapBaseLayerContext,
  MapOverlayContext,
  MapViewScope,
} from "./slots";

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

function MapViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<MapViewConfig>>) {
  const trajectoryLength = config?.trajectoryLength ?? 2000;
  const predictionEnabled = config?.showPrediction ?? true;
  const bodyOverride = config?.bodyOverride;
  // Vanilla POIs are reference points, not an opt-in feature: default on.
  const showPois = config?.showPois ?? true;

  const telemetry = useMapTelemetry(bodyOverride);
  const {
    lat,
    lon,
    speed,
    body,
    targetBodyId,
    vesselOnThisBody,
    encounterKind,
    impactLat,
    impactLon,
  } = telemetry;

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

  useMapViewActions({
    viewMode,
    setViewMode,
    setCamera,
    baseZoom,
    containerSize,
  });

  const { trajectoryRef, trajectoryCount } = useTrajectoryBuffer({
    lat: lat?.magnitude,
    lon: lon?.magnitude,
    altSea: telemetry.altSea,
    q: telemetry.q,
    mach: telemetry.mach,
    speed,
    vSpeed: telemetry.vSpeed,
    trajectoryLength,
  });

  const baseLayers = useBaseLayers();

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

  const { predictionSegments, maneuverSegments } = useGroundTrackPrediction({
    enabled: predictionEnabled,
    trajectory: telemetry.trajectory,
    orbitPatches: telemetry.orbitPatches,
    maneuverNodes: telemetry.maneuverNodes,
    targetBodyId,
    body,
    lat,
    lon,
    universalTime: telemetry.universalTime,
  });

  const {
    baseRef,
    overlayRef,
    dataRef,
    persistentDataRef,
    predictionRef,
    vesselMarked,
  } = useMapPainting({
    containerSize,
    camera,
    bodyTexture: body?.texture,
    bodyColor: body?.color,
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
  });

  const displayName = body?.name ?? targetBodyId;

  // "NO SIGNAL" belongs to the global SignalLossIndicator banner, not this chip.
  const altSeaReadout = telemetry.altSeaReadout;
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
      : telemetry.positionStale
        ? "Position not current: marker withheld"
        : targetBodyId === undefined
          ? "Waiting for telemetry..."
          : "No position data";

  const scope: MapViewScope = useMemo(
    () => ({ bodyName: displayName }),
    [displayName],
  );

  if (!showMap) {
    return (
      <WidgetScopeProvider widget="map-view" scope={scope}>
        <CompactMapView
          bodyLabel={showBodyLabel && displayName ? displayName : undefined}
          lat={lat}
          lon={lon}
          altitude={
            altSeaReadout !== undefined && rows >= 5
              ? telemetry.altitudeReading
              : undefined
          }
          positionNotice={positionNotice}
        />
      </WidgetScopeProvider>
    );
  }

  // `overlay` is null until the container has measured.
  const baseLayerContext: MapBaseLayerContext | null = containerSize
    ? {
        bodyId: targetBodyId,
        width: containerSize.w,
        height: containerSize.h,
        augmentSettings,
        coverageGate,
        onLayer: baseLayers.onLayer,
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

  const trajectoryWithheld = telemetry.trajectoryWithheld;

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
                    <DataCanvas
                      ref={dataRef}
                      data-vessel-marker={vesselMarked ? "" : undefined}
                    />
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
                          onAvailableChange={
                            baseLayers.onSuppressAvailabilityChange
                          }
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
          trajectoryWithheld && predictionEnabled && telemetry.hasPatchChain ? (
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
