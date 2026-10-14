import {
  Button,
  EmptyState,
  LiveRegion,
  Panel,
  Section,
  TextButton,
} from "@ksp-gonogo/ui-kit";
import { useState, useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
} from "../../uplinks/loaderState";

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
 * loaded, and removing the tile is switched off. While an add-on has failed to
 * load the tile says so, and removing it takes a second press, since a repaired
 * add-on would bring the widget and its saved configuration back.
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
    .filter((outcome) => outcome.status === "quarantined")
    .map((outcome) => outcome.name);
  const [confirming, setConfirming] = useState(false);
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
