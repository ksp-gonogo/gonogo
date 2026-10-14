import {
  Button,
  EmptyState,
  Panel,
  Section,
  TextButton,
} from "@ksp-gonogo/ui-kit";

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
 * loaded, and removing the tile is switched off.
 */
export function UnavailableWidget({
  componentId,
  settled,
  onRemove,
}: Readonly<UnavailableWidgetProps>) {
  return (
    <Panel
      panelTitle="WIDGET UNAVAILABLE"
      sections={[
        <Section key="unavailable" full>
          <EmptyState layout="fill">
            <code>{componentId}</code> is not available
          </EmptyState>
          {settled ? (
            <TextButton type="button" onClick={onRemove}>
              Remove
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
