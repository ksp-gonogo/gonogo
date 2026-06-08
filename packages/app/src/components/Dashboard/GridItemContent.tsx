import { RequiresGuard } from "@gonogo/components";
import {
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
} from "@gonogo/core";
import type { InputMappings } from "@gonogo/serial";
import { memo, useCallback, useMemo } from "react";
import styled from "styled-components";
import type { DashboardItem } from "./index";
import {
  ComponentWrapper,
  PushButton,
  RemoveButton,
  WidgetError,
} from "./shared";
import { GearButton, GearWrapper } from "./WidgetGearMenu";

interface GridItemContentProps {
  item: DashboardItem;
  w: number | undefined;
  h: number | undefined;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
}

// GridItemContent — memoised per-item subtree so a sibling re-render
// (e.g. one widget's useDataValue firing on a Telemachus tick) doesn't
// reconcile every other item in the grid. The parent passes stable
// callbacks (already wrapped in useCallback by useDashboardState); we
// bind them to `item.i` here so each item gets its own stable handlers.
export const GridItemContent = memo(function GridItemContent({
  item,
  w,
  h,
  updateItemConfig,
  updateItemMappings,
  removeItem,
}: GridItemContentProps) {
  const def = getComponent(item.componentId);

  const onSaveConfig = useCallback(
    (next: Record<string, unknown>) => updateItemConfig(item.i, next),
    [item.i, updateItemConfig],
  );
  const onSaveMappings = useCallback(
    (next: InputMappings) => updateItemMappings(item.i, next),
    [item.i, updateItemMappings],
  );
  const onRemove = useCallback(() => removeItem(item.i), [item.i, removeItem]);

  // Render the error fallback as a stable function so the ErrorBoundary
  // doesn't re-mount its children every render.
  const renderErrorFallback = useCallback(
    (error: Error, reset: () => void) => (
      <WidgetError
        componentName={def?.name ?? item.componentId}
        error={error}
        onRetry={reset}
      />
    ),
    [def?.name, item.componentId],
  );

  const itemContext = useMemo(() => ({ instanceId: item.i }), [item.i]);

  if (!def) return null;
  const Comp = def.component;
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  return (
    <>
      <CellHeader className="drag-handle" title="Drag to reposition">
        {/* widget-action-buttons: draggableCancel target so touch events don't trigger drag */}
        <ActionButtons className="widget-action-buttons">
          {(hasConfig || hasActions) && (
            <GearWrapper>
              <GearButton
                item={item}
                def={def}
                onSaveConfig={onSaveConfig}
                onSaveMappings={onSaveMappings}
              />
            </GearWrapper>
          )}
          <PushButton
            item={item}
            pushable={def.pushable === true}
            w={w ?? 3}
            h={h ?? 3}
          />
          <RemoveButton onRemove={onRemove} />
        </ActionButtons>
      </CellHeader>
      <ComponentWrapper>
        <DashboardItemContext.Provider value={itemContext}>
          <ErrorBoundary fallback={renderErrorFallback}>
            <RequiresGuard requires={def.requires}>
              <Comp
                id={item.i}
                config={item.config}
                w={w}
                h={h}
                onConfigChange={onSaveConfig}
              />
            </RequiresGuard>
          </ErrorBoundary>
        </DashboardItemContext.Provider>
      </ComponentWrapper>
    </>
  );
});

const CellHeader = styled.div`
  height: 18px;
  background: var(--color-surface-panel);
  cursor: grab;
  flex-shrink: 0;
  border-radius: 2px 2px 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 4px;

  @media (hover: hover) {
    &:hover {
      background: var(--color-surface-raised);
    }
  }

  &:active {
    cursor: grabbing;
  }
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  margin-left: auto;
`;
