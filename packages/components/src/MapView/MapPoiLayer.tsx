import type { MapPoi, MapPoiProviderDefinition } from "@ksp-gonogo/core";
import {
  getMapPoiProviders,
  onMapPoiProvidersChange,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  hasAnswered,
  isValue,
  type TopicId,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Button } from "@ksp-gonogo/ui";
import { Floating, Unit, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactElement, RefObject } from "react";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  markerStyleFor,
  PoiHoverActions,
  PoiHoverCard,
  PoiHoverCoords,
  PoiHoverDetail,
  PoiHoverLabel,
  PoiHoverMetaRow,
  PoiLayerRoot,
  PoiMarkerButton,
} from "./MapPoiLayer.styles";

/**
 * The always-on shared POI layer: every registered `MapPoiProvider`'s points
 * for the mapped body, with one shared hover card rather than a hover UX per
 * provider.
 */
export interface MapPoiLayerProps {
  bodyId: string | undefined;
  /** The same `MapOverlayContext.project` a `map-view.overlay` augment draws with. */
  project: (lat: number, lon: number) => { x: number; y: number };
}

// A stable snapshot, since getMapPoiProviders() allocates per call and would loop useSyncExternalStore. Refreshed by a module-load subscription so a provider registered before any layer mounts is not missed.
let cachedProviders: MapPoiProviderDefinition[] = getMapPoiProviders();
onMapPoiProvidersChange(() => {
  cachedProviders = getMapPoiProviders();
});
function getProvidersSnapshot(): MapPoiProviderDefinition[] {
  return cachedProviders;
}

export function MapPoiLayer({
  bodyId,
  project,
}: Readonly<MapPoiLayerProps>): ReactElement {
  // Re-render when providers register, so a layer mounted before a provider loads picks it up.
  const providers = useSyncExternalStore(
    onMapPoiProvidersChange,
    getProvidersSnapshot,
    getProvidersSnapshot,
  );
  const [hoveredPoi, setHoveredPoi] = useState<MapPoi | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  return (
    <PoiLayerRoot ref={layerRef}>
      {providers.map((provider) => (
        <PoiProviderGate
          key={provider.id}
          provider={provider}
          bodyId={bodyId}
          project={project}
          hoveredId={hoveredPoi?.id}
          onHover={setHoveredPoi}
        />
      ))}
      {hoveredPoi && (
        <PoiHoverCardView
          poi={hoveredPoi}
          project={project}
          layerRef={layerRef}
          onDismiss={() => setHoveredPoi(null)}
        />
      )}
    </PoiLayerRoot>
  );
}

/** Applies one provider's Domain presence gate, one component per provider so the gate hook keeps a stable position. */
function PoiProviderGate({
  provider,
  bodyId,
  project,
  hoveredId,
  onHover,
}: {
  provider: MapPoiProviderDefinition;
  bodyId: string | undefined;
  project: MapPoiLayerProps["project"];
  hoveredId: string | undefined;
  onHover: (poi: MapPoi | null) => void;
}): ReactElement | null {
  // Always called for stable hook order; the dummy topic for an ungated provider is never consulted.
  const availabilityTopic = (
    provider.requires ? `${provider.requires}.available` : ""
  ) as TopicId;
  const available = useTelemetry(availabilityTopic);

  // A `.available` topic is a presence gate: held and absent both mean installed, and only pending or unowned hides the provider.
  const domainReported = hasAnswered(available);

  if (provider.requires && !domainReported) {
    return null;
  }

  return (
    <PoiProviderMarkers
      provider={provider}
      bodyId={bodyId}
      project={project}
      hoveredId={hoveredId}
      onHover={onHover}
    />
  );
}

/** Calls the provider's own `usePois`, mounted only while its gate is satisfied. */
function PoiProviderMarkers({
  provider,
  bodyId,
  project,
  hoveredId,
  onHover,
}: {
  provider: MapPoiProviderDefinition;
  bodyId: string | undefined;
  project: MapPoiLayerProps["project"];
  hoveredId: string | undefined;
  onHover: (poi: MapPoi | null) => void;
}): ReactElement | null {
  const pois = provider.usePois({ bodyId });
  if (!pois) return null;

  return (
    <>
      {pois.map((poi) => (
        <PoiMarker
          key={poi.id}
          poi={poi}
          project={project}
          isHovered={hoveredId === poi.id}
          onHover={onHover}
        />
      ))}
    </>
  );
}

function PoiMarker({
  poi,
  project,
  isHovered,
  onHover,
}: {
  poi: MapPoi;
  project: MapPoiLayerProps["project"];
  isHovered: boolean;
  onHover: (poi: MapPoi | null) => void;
}): ReactElement {
  const { x, y } = project(poi.lat, poi.lon);
  const style: CSSProperties = { left: x, top: y };

  return (
    <PoiMarkerButton
      type="button"
      aria-label={poi.label}
      aria-expanded={isHovered}
      style={style}
      $style={markerStyleFor(poi)}
      onMouseEnter={() => onHover(poi)}
      onMouseLeave={() => {
        if (isHovered) onHover(null);
      }}
      onFocus={() => onHover(poi)}
      onBlur={() => {
        if (isHovered) onHover(null);
      }}
    />
  );
}

function PoiHoverCardView({
  poi,
  project,
  layerRef,
  onDismiss,
}: {
  poi: MapPoi;
  project: MapPoiLayerProps["project"];
  layerRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}): ReactElement {
  // Drawn over the page rather than the map, so a card near the map's edge is never cut off by it.
  const anchor = () => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const { x, y } = project(poi.lat, poi.lon);
    return { x: rect.left + x, y: rect.top + y };
  };

  const metaEntries = poi.meta
    ? Object.entries(poi.meta).filter(([, value]) => value !== undefined)
    : [];

  return (
    <Floating anchor={anchor} onMouseLeave={onDismiss}>
      <PoiHoverCard role="group" aria-label={`${poi.label} details`}>
        <PoiHoverLabel>{poi.label}</PoiHoverLabel>
        {poi.detail && <PoiHoverDetail>{poi.detail}</PoiHoverDetail>}
        <PoiHoverCoords>{`${writeQuantity(value("°", poi.lat), { decimals: 2 })}, ${writeQuantity(value("°", poi.lon), { decimals: 2 })}`}</PoiHoverCoords>
        {metaEntries.map(([key, value]) => (
          <PoiHoverMetaRow key={key}>
            <span>{key}</span>
            {/* `meta` is an open bag: a quantity gets the standard readout, anything else prints as written. */}
            <span>
              {isValue(value) ? <Unit value={value} /> : String(value)}
            </span>
          </PoiHoverMetaRow>
        ))}
        {poi.actions && poi.actions.length > 0 && (
          <PoiHoverActions>
            {poi.actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                disabled={action.disabled}
                title={
                  action.disabled && action.disabledReason
                    ? action.disabledReason
                    : undefined
                }
                onClick={() => void action.run()}
              >
                {action.label}
              </Button>
            ))}
          </PoiHoverActions>
        )}
      </PoiHoverCard>
    </Floating>
  );
}
