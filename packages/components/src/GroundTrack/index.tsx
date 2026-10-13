import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  getImagingWindow,
  latLonToMap,
  registerComponent,
} from "@ksp-gonogo/core";
import { trajectoryWithheldCopy } from "@ksp-gonogo/sitrep-sdk/frames";
import { Switch } from "@ksp-gonogo/ui";
import {
  derivedMarking,
  Panel,
  PanZoomViewport,
  ReadoutCaption,
  Section,
  Tooltip,
  WidgetScopeProvider,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo } from "react";
import { OrbitalEventChips } from "../shared/OrbitalEventChips";
import { groundTrackActions, useGroundTrackActions } from "./actions";
import { CompactGroundTrack } from "./CompactGroundTrack";
import {
  followZoom,
  nearestRepeatX,
  WORLD_H,
  WORLD_W,
  worldToScreen,
} from "./camera";
import {
  BaseCanvas,
  BodyLabel,
  CANVAS_CONTAINER,
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
} from "./GroundTrack.styles";
import { GroundTrackConfigComponent } from "./GroundTrackConfig";
import { MapPoiLayer } from "./MapPoiLayer";
import type {
  GroundTrackScope,
  MapBaseLayerContext,
  MapOverlayContext,
} from "./slots";
import type { GroundTrackConfig } from "./types";
import { useBaseLayers } from "./useBaseLayers";
import { useCamera } from "./useCamera";
import { useCoverageGate } from "./useCoverageGate";
import { useGroundTrackPrediction } from "./useGroundTrackPrediction";
import { useMapPainting } from "./useMapPainting";
import { useMapResize } from "./useMapResize";
import { useMapTelemetry } from "./useMapTelemetry";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";
import { VanillaSuppressionProbe } from "./VanillaSuppressionProbe";
// Side-effect only: registers the vanilla POI provider MapPoiLayer renders.
import "./vanillaPoiProvider";
import read from "./ground-track.declarations.g";

export type { GroundTrackActions } from "./actions";
export type {
  GroundTrackScope,
  MapBaseLayerContext,
  MapOverlayContext,
} from "./slots";

const topics = defineTopicManifest({
  /* `system.bodies` is matched by the name the running game reports, not the bundled stock table. `vessel.orbit` also carries the next apsis the chip row solves from its elements. */
  channels: [
    "vessel.flight",
    "vessel.orbit",
    "vessel.identity",
    "system.bodies",
  ],
  optionalChannels: read.optionalChannels,
  fields: [
    "vessel.flight.latitude",
    "vessel.flight.longitude",
    "vessel.flight.altitudeAsl",
    "vessel.flight.altitudeTerrain",
    "vessel.flight.verticalSpeed",
    "vessel.flight.surfaceSpeed",
    "vessel.flight.dynamicPressureKPa",
    "vessel.flight.mach",
    "vessel.maneuver.nodes",
    "vessel.identity.parentBodyIndex",
    "vessel.identity.situation",
    "vessel.orbit.patches",
    "vessel.orbit.encounter",
    "vessel.orbit.mu",
    "vessel.orbit.horizon",
  ],
});

function GroundTrackComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<GroundTrackConfig>>) {
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
  const { camera, setCamera, baseZoom, viewMode, setViewMode, panZoom } =
    useCamera(containerSize);

  useGroundTrackActions({
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
    track: `${telemetry.vesselId ?? ""} over ${targetBodyId ?? ""}`,
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
    enabled: predictionEnabled && telemetry.predictable,
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
    trajectoryRef,
    trajectoryCount,
    hasAtmosphere: body?.hasAtmosphere,
    maxAtmosphere: body?.maxAtmosphere,
    vesselOnThisBody,
    predictionSegments,
    maneuverSegments,
    impactLat,
    impactLon,
    adjustedMap,
    encounterKind,
    lat,
    lon,
    positionHeld: telemetry.positionHeld,
    modelledPosition: telemetry.modelledPosition,
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

  /** What stands in for a position that was never reported, shared so the two branches say the same thing. A held position is marked by its readouts. */
  const positionNotice =
    (lat !== undefined && lon !== undefined) || telemetry.markerWithheld
      ? undefined
      : targetBodyId === undefined
        ? "Waiting for telemetry..."
        : "No position data";

  const scope: GroundTrackScope = useMemo(
    () => ({ bodyName: displayName }),
    [displayName],
  );

  if (!showMap) {
    return (
      <WidgetScopeProvider widget="ground-track" scope={scope}>
        <CompactGroundTrack
          bodyLabel={showBodyLabel && displayName ? displayName : undefined}
          lat={telemetry.latitudeReading}
          lon={telemetry.longitudeReading}
          altitude={
            (altSeaReadout !== undefined || telemetry.altSea !== undefined) &&
            rows >= 5
              ? telemetry.altitudeReading
              : undefined
          }
          modelledPosition={telemetry.modelledPosition}
          positionMarking={derivedMarking(telemetry.latitudeReading, true)}
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
        held: vesselOnThisBody ? telemetry.latitudeReading : undefined,
        project: (projLat, projLon) => {
          const { x: wx, y: wy } = adjustedMap(
            WORLD_W,
            WORLD_H,
            projLat,
            projLon,
          );
          // The map repeats east and west, and a point is placed in the repeat nearest the centre of the view.
          return worldToScreen(
            nearestRepeatX(wx, camera.panX),
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
    <WidgetScopeProvider widget="ground-track" scope={scope}>
      <Panel
        panelTitle="GROUND TRACK"
        panelToolbar={toolbar}
        /* The sections seam sits under `MapSections`'s own divider. */
        panelSections={false}
        sections={[
          <Section key="map" fill>
            <MapBody>
              <MapFrame>
                <MapOuter ref={outerRef}>
                  <PanZoomViewport
                    panZoom={panZoom}
                    label="Map"
                    style={{
                      ...CANVAS_CONTAINER,
                      ...(containerSize
                        ? { width: containerSize.w, height: containerSize.h }
                        : undefined),
                    }}
                  >
                    <BaseCanvas
                      ref={baseRef}
                      data-testid="ground-track-base-canvas"
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
                      data-vessel-position={vesselPosition(
                        vesselMarked,
                        telemetry.positionHeld,
                      )}
                      data-vessel-modelled={
                        vesselMarked && telemetry.modelledPosition !== null
                          ? ""
                          : undefined
                      }
                    />
                    {positionNotice !== undefined && (
                      <NoSignal>{positionNotice}</NoSignal>
                    )}
                    {baseLayerContext && (
                      <AugmentSlot
                        name="ground-track.base"
                        props={baseLayerContext}
                      />
                    )}
                    {getAugmentsForSlot("ground-track.base")
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
                          name="ground-track.overlay"
                          props={overlayContext}
                        />
                      </OverlayAugmentLayer>
                    )}
                    {overlayContext && showPois && (
                      <MapPoiLayer
                        bodyId={targetBodyId}
                        project={overlayContext.project}
                        repeats={{
                          width: overlayContext.width,
                          period: WORLD_W * camera.zoom,
                        }}
                      />
                    )}
                  </PanZoomViewport>
                </MapOuter>
              </MapFrame>
            </MapBody>
          </Section>,
          /* Under the map, not over it: only the forward track is refused. */
          trajectoryWithheld && predictionEnabled && telemetry.hasPatchChain ? (
            <Section key="withheld">
              <Tooltip
                text={trajectoryWithheldCopy(trajectoryWithheld).detail}
                focusable
              >
                <ReadoutCaption role="status">
                  {trajectoryWithheldCopy(trajectoryWithheld).heading}: no
                  predicted ground track
                </ReadoutCaption>
              </Tooltip>
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

registerComponent<GroundTrackConfig>({
  id: "ground-track",
  name: "Ground Track",
  description:
    "A flat map of the current body with your vessel's position and ground track. You can show another body instead, and Uplinks can add surface maps and markers.",
  tags: ["telemetry"],
  defaultSize: { w: 12, h: 18 },
  minSize: { w: 3, h: 4 },
  component: GroundTrackComponent,
  configComponent: GroundTrackConfigComponent,
  // `vessel.orbit` is read by `OrbitalEventChips` inside this widget, so it is declared here.
  channels: topics.channels,
  // The space centre markers are reference points on the map, not a ground control.
  seats: ["mission-control", "pilot"],
  ...read,
  // The point-of-interest providers mount through a registry, so the scan cannot follow what the stock one reads and sends.
  optionalChannels: [...read.optionalChannels, "spaceCenter.pois"],
  commands: [...read.commands, "vessel.target.set"],
  fields: topics.fields,
  defaultConfig: {
    trajectoryLength: 2000,
    showPrediction: true,
  },
  actions: groundTrackActions,
  augmentSlots: [
    "ground-track.overlay",
    "ground-track.sections",
    "ground-track.base",
    "ground-track.actions",
  ],
  pushable: true,
  requires: ["flight"],
});

export { GroundTrackComponent, VanillaSuppressionProbe };

/** How the drawn marker's position is known, for anything reading the canvas from outside. */
function vesselPosition(
  marked: boolean,
  held: boolean,
): "held" | "current" | undefined {
  if (!marked) return undefined;
  return held ? "held" : "current";
}
