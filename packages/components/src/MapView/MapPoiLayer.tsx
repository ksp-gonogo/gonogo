import type { MapPoi, MapPoiProviderDefinition } from "@ksp-gonogo/core";
import {
  getMapPoiProviders,
  onMapPoiProvidersChange,
  useTelemetry,
} from "@ksp-gonogo/core";
import { isValue, type TopicId, value } from "@ksp-gonogo/sitrep-sdk";
import { Button } from "@ksp-gonogo/ui";
import { Unit, writeQuantity } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactElement } from "react";
import { useState, useSyncExternalStore } from "react";
import styled from "styled-components";

/**
 * The always-on shared POI layer: mounted as a sibling to
 * `OverlayAugmentLayer`, above the coverage-gated surface (see this file's
 * placement in `index.tsx`). Renders every registered `MapPoiProvider`'s
 * points for the currently-mapped body as markers, with ONE shared hover
 * card (label/detail/coords/meta + actions) rather than letting each
 * provider invent its own hover UX: same reasoning as `mapPoi.ts`'s own
 * header comment.
 */
export interface MapPoiLayerProps {
  bodyId: string | undefined;
  /** Project geographic lat/lon (degrees) to a pixel coordinate in this
   *  layer's own space: the same `MapOverlayContext.project` a `map-view.overlay`
   *  augment draws with, so a POI marker lands on the same pixels. */
  project: (lat: number, lon: number) => { x: number; y: number };
  width: number;
  height: number;
}

// Stable-reference snapshot cache: getMapPoiProviders() allocates a fresh
// array every call, which would infinite-loop useSyncExternalStore directly.
// Refreshed via an UNCONDITIONAL module-load subscription (mirrors
// useCoverageGate.ts's cachedSources / AugmentSlot.tsx's slotCache), not from
// inside a component lifecycle: a provider can register before any
// MapPoiLayer instance ever mounts (an Uplink SDK bundle registering before
// the operator navigates to a MapView layout), and that must not be missed.
let cachedProviders: MapPoiProviderDefinition[] = getMapPoiProviders();
onMapPoiProvidersChange(() => {
  cachedProviders = getMapPoiProviders();
});
function getProvidersSnapshot(): MapPoiProviderDefinition[] {
  return cachedProviders;
}

interface PoiKindStyle {
  background: string;
  border: string;
  borderStyle: "solid" | "dashed";
}

const KSC_STYLE: PoiKindStyle = {
  background: "var(--color-accent-fg)",
  border: "var(--color-accent-fg)",
  borderStyle: "solid",
};
const LAUNCH_SITE_STYLE: PoiKindStyle = {
  background: "var(--color-text-muted)",
  border: "var(--color-text-muted)",
  borderStyle: "solid",
};
const CONTRACT_ACTIVE_STYLE: PoiKindStyle = {
  background: "transparent",
  border: "var(--color-tag-yellow-fg)",
  borderStyle: "solid",
};
const CONTRACT_AVAILABLE_STYLE: PoiKindStyle = {
  background: "transparent",
  border: "var(--color-tag-yellow-fg)",
  borderStyle: "dashed",
};
const ANOMALY_STYLE: PoiKindStyle = {
  background: "var(--color-tag-cyan-fg)",
  border: "var(--color-tag-cyan-fg)",
  borderStyle: "solid",
};
// Generic neutral fallback so a third-party provider's novel `kind` renders
// sensibly instead of invisible/throwing.
const DEFAULT_STYLE: PoiKindStyle = {
  background: "var(--color-text-faint)",
  border: "var(--color-text-faint)",
  borderStyle: "solid",
};

function markerStyleFor(poi: MapPoi): PoiKindStyle {
  if (poi.kind === "contractTarget") {
    return poi.status === "active"
      ? CONTRACT_ACTIVE_STYLE
      : CONTRACT_AVAILABLE_STYLE;
  }
  switch (poi.kind) {
    case "ksc":
      return KSC_STYLE;
    case "launchSite":
      return LAUNCH_SITE_STYLE;
    case "anomaly":
      return ANOMALY_STYLE;
    default:
      return DEFAULT_STYLE;
  }
}

const PoiLayerRoot = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

const PoiMarkerButton = styled.button<{ $style: PoiKindStyle }>`
  position: absolute;
  width: 10px;
  height: 10px;
  /* Off the spacing ladder: exactly half the 10px marker above, centring it
     on its coordinate. It tracks that size, not a rung. */
  margin: -5px 0 0 -5px;
  padding: 0;
  border-radius: var(--radius-circle);
  cursor: pointer;
  pointer-events: auto;
  background: ${({ $style }) => $style.background};
  border: 2px ${({ $style }) => $style.borderStyle} ${({ $style }) => $style.border};

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const PoiHoverCard = styled.div`
  position: absolute;
  pointer-events: auto;
  min-width: 160px;
  max-width: 240px;
  padding: var(--space-8) var(--space-10);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  /* Off the app z-index ladder: the only z-index in this file, so its value
     is meaningless in isolation. Its contract is 1-versus-auto against the
     markers it covers, not a place on the app ladder. */
  z-index: 1;
`;

const PoiHoverLabel = styled.div`
  font-weight: 600;
  margin-bottom: var(--space-2);
`;

const PoiHoverDetail = styled.div`
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
`;

const PoiHoverCoords = styled.div`
  color: var(--color-text-dim);
  margin-bottom: var(--space-4);
`;

const PoiHoverMetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--space-8);
`;

const PoiHoverActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  margin-top: var(--space-6);
`;

export function MapPoiLayer({
  bodyId,
  project,
  width,
  height,
}: Readonly<MapPoiLayerProps>): ReactElement {
  // Re-render when providers register/unregister so a layer mounted before
  // a provider's module loads still picks it up (mirrors AugmentSlot).
  const providers = useSyncExternalStore(
    onMapPoiProvidersChange,
    getProvidersSnapshot,
    getProvidersSnapshot,
  );
  const [hoveredPoi, setHoveredPoi] = useState<MapPoi | null>(null);

  return (
    <PoiLayerRoot>
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
          width={width}
          height={height}
          onDismiss={() => setHoveredPoi(null)}
        />
      )}
    </PoiLayerRoot>
  );
}

/**
 * Applies one provider's Domain presence gate. Isolated into its own
 * component (mirrors `AugmentSlot.tsx`'s `AugmentEntry`) so its
 * `useTelemetry` gate hook has a stable position regardless of how many
 * sibling providers are registered or how the registered set changes.
 */
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
  // Always call the hook (stable order); the topic is only meaningful when
  // the provider declares `requires`. A dummy topic for the ungated case
  // reads `undefined` off the store and is never consulted.
  const availabilityTopic = (
    provider.requires ? `${provider.requires}.available` : ""
  ) as TopicId;
  const available = useTelemetry(availabilityTopic);

  // Whether the domain has EVER reported. A `.available` topic is a presence
  // gate, not a quantity: a domain that reported and then went quiet is still
  // installed, so `stale` counts as available and only a never-arrived reading
  // hides the provider.
  //
  // This was `available === undefined`, which is why it needed changing rather
  // than merely compiling: a `Reading` is never undefined, so the gate would
  // have failed OPEN and rendered every gated provider unconditionally. The
  // comparison stayed legal, so the types said nothing; `MapPoiLayer.test.tsx`
  // is what caught it.
  // `absent` counts too: a producer answering "there is no value" is still a
  // producer, so the Uplink is installed. `pending` is the only answer that means
  // nothing is there, which is why this reads as a single negative test.
  const domainReported = available.state !== "pending";

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

/**
 * Calls the provider's own `usePois` hook and renders one marker per POI.
 * A distinct component instance from `PoiProviderGate` so `usePois`, which
 * itself may call `useTelemetry`/`useMemo`/etc, is only ever mounted (and
 * its hooks only ever called) while the provider's gate is satisfied.
 */
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
  width,
  height,
  onDismiss,
}: {
  poi: MapPoi;
  project: MapPoiLayerProps["project"];
  width: number;
  height: number;
  onDismiss: () => void;
}): ReactElement {
  const { x, y } = project(poi.lat, poi.lon);
  // Flip the card to the opposite side of the marker when it would
  // otherwise overflow the map's own edge.
  const openLeft = x > width - 200;
  const openUp = y > height - 120;
  const style: CSSProperties = {
    left: x,
    top: y,
    transform: `translate(${openLeft ? "calc(-100% - 8px)" : "8px"}, ${
      openUp ? "calc(-100% - 8px)" : "8px"
    })`,
  };

  const metaEntries = poi.meta
    ? Object.entries(poi.meta).filter(([, value]) => value !== undefined)
    : [];

  return (
    <PoiHoverCard
      role="group"
      aria-label={`${poi.label} details`}
      style={style}
      onMouseEnter={() => {}}
      onMouseLeave={onDismiss}
    >
      <PoiHoverLabel>{poi.label}</PoiHoverLabel>
      {poi.detail && <PoiHoverDetail>{poi.detail}</PoiHoverDetail>}
      <PoiHoverCoords>{`${writeQuantity(value("°", poi.lat), { decimals: 2 })}, ${writeQuantity(value("°", poi.lon), { decimals: 2 })}`}</PoiHoverCoords>
      {metaEntries.map(([key, value]) => (
        <PoiHoverMetaRow key={key}>
          <span>{key}</span>
          {/* `meta` is an open bag, so a provider can put anything in it.
              A quantity gets the readout every other quantity gets; a
              string or a flag is still whatever the provider wrote. */}
          <span>{isValue(value) ? <Unit value={value} /> : String(value)}</span>
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
  );
}
