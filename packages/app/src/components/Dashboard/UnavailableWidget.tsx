import { EmptyState, Panel, Section, TextButton } from "@ksp-gonogo/ui-kit";

interface UnavailableWidgetProps {
  /** The saved widget id that no registered widget answers to. */
  componentId: string;
  onRemove: () => void;
}

/**
 * The tile that stands in a saved position when the dashboard names a widget
 * that is not registered: it says which id is missing and offers to remove the
 * tile, so a saved layout never loses a tile silently.
 */
export function UnavailableWidget({
  componentId,
  onRemove,
}: Readonly<UnavailableWidgetProps>) {
  return (
    <Panel
      panelTitle="WIDGET UNAVAILABLE"
      sections={[
        <Section key="unavailable" full>
          <EmptyState layout="fill">
            <code>{componentId}</code> is not available in this version
          </EmptyState>
          <TextButton type="button" onClick={onRemove}>
            Remove
          </TextButton>
        </Section>,
      ]}
    />
  );
}
