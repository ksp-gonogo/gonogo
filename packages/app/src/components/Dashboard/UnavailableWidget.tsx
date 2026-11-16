import {
  Button,
  EmptyState,
  LiveRegion,
  Panel,
  Section,
  TextButton,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  getUplinkOutcomes,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "../../uplinks/loaderState";

/** How long the second press stays armed once the first has been made. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * Whether an Uplink could have supplied this widget. An Uplink whose manifest
 * was read lists its widget ids and is matched by them. One that lists none
 * (no manifest read, or one that predates the list) is matched by its id as the
 * widget id or its leading segment: an id that carries no such prefix is then
 * attributed to no Uplink.
 */
function ownedBy(outcome: UplinkLoadOutcome, componentId: string): boolean {
  if (outcome.widgets) return outcome.widgets.includes(componentId);
  return componentId === outcome.id || componentId.startsWith(`${outcome.id}-`);
}

/* The section already insets its body, so the fill layout's own padding would leave a 74px tile with 42px for the id. */
const Unavailable__Empty = styled(EmptyState)`
  padding: var(--inset-message-above-control);
`;

const Unavailable__Message = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  width: 100%;
  min-width: 0;
`;

const Unavailable__Id = styled.code`
  max-width: 100%;
  overflow-wrap: break-word;
`;

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
 * loaded, and removing the tile is switched off, as it is while any add-on is
 * still starting, which the tile names when its id carries that add-on's
 * prefix. While the add-on that owns the widget has failed to load the tile
 * says so, and removing it takes a second press that lapses when the pointer or
 * focus leaves the button or after a few seconds, since a repaired add-on would
 * bring the widget and its saved configuration back. A tile whose add-on is
 * held back because the game does not run the mod it integrates with names
 * that add-on and gives the mod's own reason, and removes in a single press
 * like a tile no failed add-on owns, which says nothing about one.
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
  const owned = outcomes.filter(
    (outcome) =>
      outcome.status === "quarantined" && ownedBy(outcome, componentId),
  );
  const notRun = owned.find((outcome) => outcome.refusedOnHealth);
  const failed = owned
    .filter((outcome) => !outcome.refusedOnHealth)
    .map((outcome) => outcome.name);
  /*
   * An Uplink that is still starting brings its widgets once it has. Most widget ids
   * carry no Uplink prefix, so while any Uplink waits no tile is removable, and the
   * one an Uplink's prefix names says which.
   */
  const anyWaiting = outcomes.some((outcome) => outcome.status === "waiting");
  const waiting = outcomes
    .filter(
      (outcome) =>
        outcome.status === "waiting" && ownedBy(outcome, componentId),
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
      compactTitle={["UNAVAILABLE", "N/A"]}
      sections={[
        <Section key="unavailable" full>
          <Unavailable__Empty layout="fill">
            <Unavailable__Message>
              <Unavailable__Id>{notRun?.name ?? componentId}</Unavailable__Id>
              <span>
                {notRun
                  ? (notRun.healthDetail ?? "is not available")
                  : "is not available"}
              </span>
            </Unavailable__Message>
          </Unavailable__Empty>
          <LiveRegion as="div">
            {waiting.length > 0
              ? `${waiting.join(", ")} has not finished loading, so this widget will arrive once it has`
              : failed.length > 0
                ? `${failed.join(", ")} failed to load, so this widget may return once it is repaired`
                : null}
          </LiveRegion>
          {settled && !anyWaiting ? (
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
