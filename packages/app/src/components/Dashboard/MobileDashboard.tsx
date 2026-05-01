import {
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
} from "@gonogo/core";
import type { InputMappings } from "@gonogo/serial";
import { memo, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import type { DashboardItem, DashboardProps } from "./index";
import { ROW_HEIGHT } from "./layoutNormalization";
import {
  ComponentWrapper,
  highlightStyle,
  PushButton,
  RemoveButton,
  WidgetError,
} from "./shared";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";
import { GearButton } from "./WidgetGearMenu";

// MobileDashboard — flex-wrap column with up/down reorder buttons.
//   • mobileWidth='half' items take ~50% and pair on a row when consecutive;
//     'full' (default) takes the whole row.
//   • mobileHeight (px) defaults to defaultSize.h * ROW_HEIGHT.
//   • Item order is driven by `items` (not the persisted grid `layouts`).
export function MobileDashboard({
  items,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  moveItemUp,
  moveItemDown,
  lastAddedId,
  clearLastAdded,
}: Readonly<DashboardProps>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useScrollIntoViewOnAdd(listRef, lastAddedId, clearLastAdded);
  return (
    <MobileList ref={listRef}>
      {items.map((item, index) => (
        <MobileItemContent
          key={item.i}
          item={item}
          isFirst={index === 0}
          isLast={index === items.length - 1}
          updateItemConfig={updateItemConfig}
          updateItemMappings={updateItemMappings}
          removeItem={removeItem}
          moveItemUp={moveItemUp}
          moveItemDown={moveItemDown}
          isHighlighted={lastAddedId === item.i}
          onHighlightEnd={clearLastAdded}
        />
      ))}
    </MobileList>
  );
}

interface MobileItemContentProps {
  item: DashboardItem;
  isFirst: boolean;
  isLast: boolean;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
  moveItemUp: (id: string) => void;
  moveItemDown: (id: string) => void;
  isHighlighted: boolean;
  onHighlightEnd?: (id: string) => void;
}

const MobileItemContent = memo(function MobileItemContent({
  item,
  isFirst,
  isLast,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  moveItemUp,
  moveItemDown,
  isHighlighted,
  onHighlightEnd,
}: MobileItemContentProps) {
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
  const onMoveUp = useCallback(() => moveItemUp(item.i), [item.i, moveItemUp]);
  const onMoveDown = useCallback(
    () => moveItemDown(item.i),
    [item.i, moveItemDown],
  );
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
  const half = def.mobileWidth === "half";
  const height = def.mobileHeight ?? (def.defaultSize?.h ?? 3) * ROW_HEIGHT;
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  return (
    <MobileCell
      $half={half}
      $height={height}
      data-i={item.i}
      data-highlight={isHighlighted ? "true" : undefined}
      onAnimationEnd={
        isHighlighted ? () => onHighlightEnd?.(item.i) : undefined
      }
      data-mobile-width={half ? "half" : "full"}
      data-mobile-height={height}
    >
      <MobileCellHeader>
        <MobileCellHeaderLeft>
          <ReorderButton direction="up" disabled={isFirst} onClick={onMoveUp} />
          <ReorderButton
            direction="down"
            disabled={isLast}
            onClick={onMoveDown}
          />
          <MobileCellName title={def.name}>{def.name}</MobileCellName>
        </MobileCellHeaderLeft>
        <MobileCellHeaderRight>
          {(hasConfig || hasActions) && (
            <GearButton
              item={item}
              def={def}
              onSaveConfig={onSaveConfig}
              onSaveMappings={onSaveMappings}
            />
          )}
          <PushButton
            item={item}
            pushable={def.pushable === true}
            w={def.defaultSize?.w ?? 3}
            h={def.defaultSize?.h ?? 3}
          />
          <RemoveButton onRemove={onRemove} />
        </MobileCellHeaderRight>
      </MobileCellHeader>
      <ComponentWrapper>
        <DashboardItemContext.Provider value={itemContext}>
          <ErrorBoundary fallback={renderErrorFallback}>
            <Comp
              id={item.i}
              config={item.config}
              onConfigChange={onSaveConfig}
            />
          </ErrorBoundary>
        </DashboardItemContext.Provider>
      </ComponentWrapper>
    </MobileCell>
  );
});

function ReorderButton({
  direction,
  disabled,
  onClick,
}: Readonly<{
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}>) {
  const label = direction === "up" ? "Move up" : "Move down";
  const glyph = direction === "up" ? "▲" : "▼";
  return (
    <ReorderBtn
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {glyph}
    </ReorderBtn>
  );
}

const MobileList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  align-content: flex-start;
`;

const MobileCell = styled.div<{ $half: boolean; $height: number }>`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  flex: 0 0 ${({ $half }) => ($half ? "calc(50% - 4px)" : "100%")};
  height: ${({ $height }) => $height}px;
  ${highlightStyle}
`;

const MobileCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  flex-shrink: 0;
  background: var(--color-surface-panel);
  border-radius: 2px 2px 0 0;
  padding: 0 4px;
`;

const MobileCellHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
`;

const MobileCellHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
`;

const MobileCellName = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

const ReorderBtn = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  line-height: 1;
  width: 28px;
  height: 24px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    &:not(:disabled):hover {
      color: var(--color-text-primary);
      border-color: var(--color-text-faint);
    }
  }
`;
