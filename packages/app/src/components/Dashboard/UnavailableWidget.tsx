import {
  Button,
  EmptyState,
  LiveRegion,
  Panel,
  Section,
  TextButton,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
} from "../../uplinks/loaderState";

/** How long the second press stays armed once the first has been made. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * Whether an Uplink could have supplied this widget. The loader keeps no list
 * of widget ids for an Uplink that never loaded, so ownership is the Uplink's
 * id as the widget id or its leading segment: an id that carries no such
 * prefix is attributed to no Uplink.
 */
function ownedBy(uplinkId: string, componentId: string): boolean {
  return componentId === uplinkId || componentId.startsWith(`${uplinkId}-`);
}

interface UnavailableWidgetProps {
  /** The saved widget id that no registered widget answers to. */
  componentId: string;
  /** True once every Uplink that can load has been attempted, so the id can no longer be one an Uplink is about to supply. */
  settled: boolean;
  onRemove: () => void;
}

/**
 * The tile that stands in a saved position when the dashboard names a widget
 * that is not registered: it names the missing id and, once every Uplink has
 * been attempted, offers to remove the tile, so a saved layout never loses a
 * tile silently. Until then the id may still belong to an Uplink that has not
 * loaded, and removing the tile is switched off. While the add-on that owns the
 * widget has failed to load the tile says so, and removing it takes a second
 * press that lapses when the pointer or focus leaves the button or after a few
 * seconds, since a repaired add-on would bring the widget and its saved
 * configuration back. A tile no failed add-on owns says nothing about one and
 * removes in a single press.
 */
export function UnavailableWidget({
  componentId,
  settled,
  onRemove,
}: Readonly<UnavailableWidgetProps>) {
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
    getUplinkOutcomes,
  );
  const failed = outcomes
    .filter(
      (outcome) =>
        outcome.status === "quarantined" && ownedBy(outcome.id, componentId),
    )
    .map((outcome) => outcome.name);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [confirming]);
  return (
    <Panel
      panelTitle="WIDGET UNAVAILABLE"
      sections={[
        <Section key="unavailable" full>
          <EmptyState layout="fill">
            <code>{componentId}</code> is not available
          </EmptyState>
          <LiveRegion as="div">
            {failed.length > 0
              ? `${failed.join(", ")} failed to load, so this widget may return once it is repaired`
              : null}
          </LiveRegion>
          {settled ? (
            <TextButton
              type="button"
              onPointerLeave={() => setConfirming(false)}
              onBlur={() => setConfirming(false)}
              onClick={
                failed.length > 0 && !confirming
                  ? () => setConfirming(true)
                  : onRemove
              }
            >
              {failed.length > 0 && confirming
                ? "Press again to remove"
                : "Remove"}
            </TextButton>
          ) : (
            <Button
              type="button"
              disabled
              disabledReason="Uplinks have not finished loading, so this widget may still arrive"
            >
              Remove
            </Button>
          )}
        </Section>,
      ]}
    />
  );
}
