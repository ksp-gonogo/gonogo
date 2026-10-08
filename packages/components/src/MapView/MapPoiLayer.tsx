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
import { Floating, Tooltip, Unit, writeQuantity } from "@ksp-gonogo/ui-kit";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  ReactElement,
  RefObject,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
 * The always-on shared POI layer: every registered map POI provider's points
 * for the mapped body, with one shared hover card rather than a hover UX per
 * provider.
 */
export interface MapPoiLayerProps {
  bodyId: string | undefined;
  /** The same `MapOverlayContext.project` a `map-view.overlay` augment draws with. */
  project: (lat: number, lon: number) => { x: number; y: number };
}

/** How long the card outlives the pointer leaving its marker, so the pointer can cross the gap to the card. */
const CARD_CLOSE_GRACE_MS = 250;

const CARD_CONTROLS =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** What a marker and the card tell the layer about the pointer and focus. */
interface PoiHover {
  hoveredId: string | undefined;
  /** Opens the card for `poi` and cancels any pending close. */
  show: (poi: MapPoi, marker: HTMLElement) => void;
  /** Starts the close grace; `keep` cancels it. */
  leave: () => void;
  keep: () => void;
  /** Closes at once and returns focus to the marker that opened the card. */
  dismiss: () => void;
  /** Moves focus from the marker into the card; false when the card has no control to reach. */
  enterCard: () => boolean;
  /** Moves focus from the card back to the marker. */
  returnToMarker: () => void;
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
  const cardRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const keep = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  useEffect(() => keep, [keep]);

  const hover = useMemo<PoiHover>(
    () => ({
      hoveredId: hoveredPoi?.id,
      show: (poi, marker) => {
        keep();
        markerRef.current = marker;
        setHoveredPoi(poi);
      },
      leave: () => {
        keep();
        closeTimer.current = setTimeout(
          () => setHoveredPoi(null),
          CARD_CLOSE_GRACE_MS,
        );
      },
      keep,
      // Focus first: the marker's focus handler reopens the card, and the close set last wins.
      dismiss: () => {
        markerRef.current?.focus();
        keep();
        setHoveredPoi(null);
      },
      enterCard: () => {
        const first =
          cardRef.current?.querySelector<HTMLElement>(CARD_CONTROLS);
        if (!first) return false;
        keep();
        first.focus();
        return true;
      },
      returnToMarker: () => markerRef.current?.focus(),
    }),
    [hoveredPoi?.id, keep],
  );

  return (
    <PoiLayerRoot ref={layerRef}>
      {providers.map((provider) =>
        provider.requires ? (
          <PoiProviderGate
            key={provider.id}
            requires={provider.requires}
            provider={provider}
            bodyId={bodyId}
            project={project}
            hover={hover}
          />
        ) : (
          <PoiProviderMarkers
            key={provider.id}
            provider={provider}
            bodyId={bodyId}
            project={project}
            hover={hover}
          />
        ),
      )}
      {hoveredPoi && (
        <PoiHoverCardView
          poi={hoveredPoi}
          project={project}
          layerRef={layerRef}
          cardRef={cardRef}
          hover={hover}
        />
      )}
    </PoiLayerRoot>
  );
}

/** Applies a gated provider's Domain presence gate; an ungated provider mounts its markers directly and reads no availability topic. */
function PoiProviderGate({
  requires,
  provider,
  bodyId,
  project,
  hover,
}: {
  requires: string;
  provider: MapPoiProviderDefinition;
  bodyId: string | undefined;
  project: MapPoiLayerProps["project"];
  hover: PoiHover;
}): ReactElement | null {
  const available = useTelemetry(`${requires}.available` as TopicId);

  // A `.available` topic is a presence gate: held and absent both mean installed, and only pending or unowned hides the provider.
  if (!hasAnswered(available)) return null;

  return (
    <PoiProviderMarkers
      provider={provider}
      bodyId={bodyId}
      project={project}
      hover={hover}
    />
  );
}

/** Calls the provider's own `usePois`, mounted only while its gate is satisfied. */
function PoiProviderMarkers({
  provider,
  bodyId,
  project,
  hover,
}: {
  provider: MapPoiProviderDefinition;
  bodyId: string | undefined;
  project: MapPoiLayerProps["project"];
  hover: PoiHover;
}): ReactElement | null {
  const pois = provider.usePois({ bodyId });
  if (!pois) return null;

  return (
    <>
      {pois.map((poi) => (
        <PoiMarker key={poi.id} poi={poi} project={project} hover={hover} />
      ))}
    </>
  );
}

function PoiMarker({
  poi,
  project,
  hover,
}: {
  poi: MapPoi;
  project: MapPoiLayerProps["project"];
  hover: PoiHover;
}): ReactElement {
  const isHovered = hover.hoveredId === poi.id;
  const { x, y } = project(poi.lat, poi.lon);
  const style: CSSProperties = { left: x, top: y };

  return (
    <PoiMarkerButton
      type="button"
      aria-label={poi.label}
      aria-expanded={isHovered}
      style={style}
      $style={markerStyleFor(poi)}
      onMouseEnter={(e) => hover.show(poi, e.currentTarget)}
      onMouseLeave={() => {
        if (isHovered) hover.leave();
      }}
      onFocus={(e) => hover.show(poi, e.currentTarget)}
      onBlur={() => {
        if (isHovered) hover.leave();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isHovered) {
          e.stopPropagation();
          hover.dismiss();
          return;
        }
        // The card is portalled to the page body, so Tab would skip past it.
        if (e.key === "Tab" && !e.shiftKey && isHovered && hover.enterCard()) {
          e.preventDefault();
        }
      }}
    />
  );
}

function PoiHoverCardView({
  poi,
  project,
  layerRef,
  cardRef,
  hover,
}: {
  poi: MapPoi;
  project: MapPoiLayerProps["project"];
  layerRef: RefObject<HTMLDivElement | null>;
  cardRef: RefObject<HTMLDivElement>;
  hover: PoiHover;
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
    <Floating
      anchor={anchor}
      onMouseEnter={hover.keep}
      onMouseLeave={hover.leave}
      onFocus={hover.keep}
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hover.leave();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) =>
        handleCardKey(e, cardRef.current, hover)
      }
    >
      <PoiHoverCard
        ref={cardRef}
        role="group"
        aria-label={`${poi.label} details`}
      >
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
              <Tooltip
                key={action.id}
                text={
                  action.disabled && action.disabledReason
                    ? action.disabledReason
                    : undefined
                }
              >
                <Button
                  type="button"
                  disabled={action.disabled}
                  onClick={() => void action.run()}
                >
                  {action.label}
                </Button>
              </Tooltip>
            ))}
          </PoiHoverActions>
        )}
      </PoiHoverCard>
    </Floating>
  );
}

/** Escape closes the card; Tab off either end of its controls returns to the marker so focus never strands in the portal. */
function handleCardKey(
  e: KeyboardEvent<HTMLDivElement>,
  card: HTMLDivElement | null,
  hover: PoiHover,
): void {
  if (e.key === "Escape") {
    e.stopPropagation();
    hover.dismiss();
    return;
  }
  if (e.key !== "Tab" || !card) return;
  const controls = card.querySelectorAll<HTMLElement>(CARD_CONTROLS);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    hover.returnToMarker();
    return;
  }
  if (!e.shiftKey && document.activeElement === last) hover.returnToMarker();
}
