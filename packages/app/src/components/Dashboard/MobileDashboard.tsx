import { RequiresGuard } from "@ksp-gonogo/components";
import {
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
} from "@ksp-gonogo/core";
import type { InputMappings } from "@ksp-gonogo/serial";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FullHeightIcon,
  FullWidthIcon,
  HalfHeightIcon,
  HalfWidthIcon,
} from "@ksp-gonogo/ui";
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

// MobileDashboard: flex-wrap column with up/down reorder buttons.
//   • mobileWidth='half' items take ~50% and pair on a row when consecutive;
//     'full' (default) takes the whole row.
//   • mobileHeight (px) defaults to defaultSize.h * ROW_HEIGHT.
//   • Item order is driven by `items` (not the persisted grid `layouts`).
export function MobileDashboard({
  items,
  updateItemConfig,
  updateItemMappings,
  updateItemMobileWidth,
  updateItemMobileHeight,
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
          updateItemMobileWidth={updateItemMobileWidth}
          updateItemMobileHeight={updateItemMobileHeight}
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
  updateItemMobileWidth: (id: string, width: "full" | "half") => void;
  updateItemMobileHeight: (id: string, height: "full" | "half") => void;
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
  updateItemMobileWidth,
  updateItemMobileHeight,
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
  // Per-instance override beats the component's default. Stored on the
  // DashboardItem so it persists per screen (mobile and desktop layouts
  // both live in the same localStorage entry).
  const effectiveWidth = item.mobileWidth ?? def.mobileWidth ?? "full";
  const half = effectiveWidth === "half";
  const fullHeightPx =
    def.mobileHeight ?? (def.defaultSize?.h ?? 3) * ROW_HEIGHT;
  // Per-instance height override; defaults to "full". Half-height pairs
  // alongside another half-height widget if both are also half-width
  // (the row-fill arithmetic still works because the cell wraps).
  const halfHeight = item.mobileHeight === "half";
  const height = halfHeight ? Math.round(fullHeightPx / 2) : fullHeightPx;
  // Pass derived grid units to the component so size-bucket-aware widgets
  // (e.g. Graph's auto-mini) work on mobile too. Mobile uses the xxs
  // breakpoint's 6-col mental model: half = 3, full = 6. Height in grid
  // units derives from the cell pixel height.
  const gridW = half ? 3 : 6;
  const gridH = Math.max(1, Math.round(height / ROW_HEIGHT));
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);
  const onToggleWidth = () =>
    updateItemMobileWidth(item.i, half ? "full" : "half");
  const onToggleHeight = () =>
    updateItemMobileHeight(item.i, halfHeight ? "full" : "half");

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
          <WidthToggleButton half={half} onClick={onToggleWidth} />
          <HeightToggleButton half={halfHeight} onClick={onToggleHeight} />
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
            <RequiresGuard requires={def.requires} channels={def.channels}>
              <Comp
                id={item.i}
                config={item.config}
                w={gridW}
                h={gridH}
                onConfigChange={onSaveConfig}
              />
            </RequiresGuard>
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
  const Glyph = direction === "up" ? ChevronUpIcon : ChevronDownIcon;
  return (
    <ReorderBtn
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Glyph size={16} />
    </ReorderBtn>
  );
}

function WidthToggleButton({
  half,
  onClick,
}: Readonly<{ half: boolean; onClick: () => void }>) {
  const label = half ? "Expand to full width" : "Shrink to half width";
  const Glyph = half ? FullWidthIcon : HalfWidthIcon;
  return (
    <WidthToggleBtn
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={half}
    >
      <Glyph size={14} />
    </WidthToggleBtn>
  );
}

function HeightToggleButton({
  half,
  onClick,
}: Readonly<{ half: boolean; onClick: () => void }>) {
  const label = half ? "Expand to full height" : "Shrink to half height";
  const Glyph = half ? FullHeightIcon : HalfHeightIcon;
  return (
    <WidthToggleBtn
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={half}
    >
      <Glyph size={14} />
    </WidthToggleBtn>
  );
}

const MobileList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  width: 100%;
  align-content: flex-start;
`;

const MobileCell = styled.div<{ $half: boolean; $height: number }>`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  /* Exactly half of MobileList's gap, expressed as arithmetic on the same
     token rather than a second 4px literal, so a half-width cell keeps
     tracking the gutter if --space-8 ever moves. The desktop branch's
     GridDashboard margin={[8, 8]} is the third copy of this gutter and is a
     react-grid-layout JS prop no CSS pass can see; keep it equal to this. */
  flex: 0 0
    ${({ $half }) => ($half ? "calc(50% - var(--space-8) / 2)" : "100%")};
  height: ${({ $height }) => $height}px;
  ${highlightStyle}
`;

const MobileCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  /* Off the spacing ladder: a header height, not an inset. The 32 -> 24 snap
     would clip ReorderBtn below (28x24 plus a 1px border, so 26px of box) top
     and bottom, and drop a mobile-only touch target from 32px to 24px. Move
     it only together with that button. */
  height: 32px;
  flex-shrink: 0;
  background: var(--color-surface-panel);
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  padding: 0 var(--space-4);
`;

const MobileCellHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  flex: 1;
`;

const MobileCellHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
`;

const MobileCellName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

const WidthToggleBtn = styled.button`
  pointer-events: all;
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-flush);
  padding: var(--space-hair) var(--space-4);
  margin-left: var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &[aria-pressed="true"] {
    color: var(--color-status-info-fg);
  }

  &:hover {
    color: var(--color-text-primary);
  }
`;

const ReorderBtn = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-flush);
  width: 28px;
  height: 24px;
  border-radius: var(--radius-sm);
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
