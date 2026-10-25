import { getComponent } from "@ksp-gonogo/core";
import type { InputMappings } from "@ksp-gonogo/serial";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import { memo, useCallback, useRef, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  getUplinkOutcomes,
  haveUplinksSettled,
  subscribeUplinkOutcomes,
} from "../../uplinks/loaderState";
import type { DashboardItem, DashboardProps } from "./index";
import { ROW_HEIGHT } from "./layoutNormalization";
import { ComponentWrapper, highlightStyle } from "./shared";
import { TileMenu } from "./TileMenu";
import { WidgetProviders, WidgetShell } from "./TileWidget";
import { UnavailableWidget } from "./UnavailableWidget";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";
import { GearButton } from "./WidgetGearMenu";

// MobileDashboard: flex-wrap list whose tiles reorder, resize and remove from a per-tile menu.
//   • mobileWidth='half' items take ~50% and pair on a row when consecutive;
//     'full' (default) takes the whole row.
//   • mobileHeight (px) defaults to defaultSize.h * ROW_HEIGHT.
//   • Item order is driven by `items` (not the persisted grid `layout`).
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
  const uplinkOutcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
    getUplinkOutcomes,
  );
  const uplinksSettled = useSyncExternalStore(
    subscribeUplinkOutcomes,
    haveUplinksSettled,
    haveUplinksSettled,
  );
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
  if (!def) {
    // An Uplink's widgets register once its client loads, so nothing is drawn while one is still loading.
    if (uplinkOutcomes.some((o) => o.status === "loading")) return null;
    const unavailableHeight = 3 * ROW_HEIGHT;
    return (
      <MobileCell
        $half={false}
        $height={unavailableHeight}
        data-i={item.i}
        data-mobile-width="full"
        data-mobile-height={unavailableHeight}
      >
        <ComponentWrapper>
          <UnavailableWidget
            componentId={item.componentId}
            settled={uplinksSettled}
            onRemove={onRemove}
          />
        </ComponentWrapper>
      </MobileCell>
    );
  }
  const Comp = def.component;
  const declaredConfig = item.config ?? def.defaultConfig ?? {};
  // Per-instance override beats the component's default. Stored on the
  // DashboardItem so it persists per screen (mobile and desktop layouts
  // both live in the same localStorage entry).
  const effectiveWidth = item.mobileWidth ?? def.mobileWidth ?? "half";
  const half = effectiveWidth === "half";
  const fullHeightPx =
    def.mobileHeight ?? (def.defaultSize?.h ?? 3) * ROW_HEIGHT;
  // Per-instance height override; defaults to "full". Half-height pairs
  // alongside another half-height widget if both are also half-width
  // (the row-fill arithmetic still works because the cell wraps).
  const halfHeight = item.mobileHeight === "half";
  const height = halfHeight ? Math.round(fullHeightPx / 2) : fullHeightPx;
  // Pass derived grid units to the component so size-bucket-aware widgets
  // (e.g. Graph's auto-mini) work on mobile too. The list counts a row as
  // 6 columns: half = 3, full = 6. Height in grid units derives from the
  // cell pixel height.
  const gridW = Math.round((half ? 3 : 6) / LIST_WIDGET_SCALE);
  const gridH = Math.max(
    1,
    Math.round(height / LIST_WIDGET_SCALE / ROW_HEIGHT),
  );
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);
  const onToggleWidth = () =>
    updateItemMobileWidth(item.i, half ? "full" : "half");
  const onToggleHeight = () =>
    updateItemMobileHeight(item.i, halfHeight ? "full" : "half");

  return (
    <WidgetProviders def={def} config={declaredConfig}>
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
            <Tooltip text={def.name} announce={false}>
              <MobileCellName>{def.name}</MobileCellName>
            </Tooltip>
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
            <TileMenu
              item={item}
              name={def.name}
              pushable={def.pushable === true}
              w={def.defaultSize?.w ?? 3}
              h={def.defaultSize?.h ?? 3}
              isFirst={isFirst}
              isLast={isLast}
              half={half}
              halfHeight={halfHeight}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onToggleWidth={onToggleWidth}
              onToggleHeight={onToggleHeight}
              onRemove={onRemove}
            />
          </MobileCellHeaderRight>
        </MobileCellHeader>
        <ScaledBody>
          <WidgetShell
            def={def}
            item={item}
            config={declaredConfig}
            updateItemConfig={updateItemConfig}
          >
            <Comp
              id={item.i}
              config={item.config}
              w={gridW}
              h={gridH}
              onConfigChange={onSaveConfig}
            />
          </WidgetShell>
        </ScaledBody>
      </MobileCell>
    </WidgetProviders>
  );
});

/**
 * How far a list tile draws its widget below the size the widget is laid out
 * for. Widgets are built against the desktop grid's density, which leaves a
 * half-width tile on a phone too cramped to show what a desktop tile shows, so
 * the body is zoomed out and the widget is told the larger size it now has.
 */
export const LIST_WIDGET_SCALE = 0.8;

const ScaledBody = styled(ComponentWrapper)`
  zoom: ${LIST_WIDGET_SCALE};
  /* Zoomed out, a 44px control would draw ${Math.round(44 * LIST_WIDGET_SCALE)}px, so its floor rises to keep 44px on screen. */
  --touch-target: ${Math.round(44 / LIST_WIDGET_SCALE)}px;
  --control-height-touch: ${Math.round(44 / LIST_WIDGET_SCALE)}px;
`;

const MobileList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gutter-dashboard);
  width: 100%;
  align-content: flex-start;
`;

const MobileCell = styled.div<{ $half: boolean; $height: number }>`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  /* Exactly half of MobileList's gap, expressed as arithmetic on the same
     --gutter-dashboard rather than a second 4px literal, so a half-width cell
     keeps tracking the gutter. The desktop branch's
     GridDashboard margin={[8, 8]} is the third copy of this gutter and is a
     react-grid-layout JS prop no CSS pass can see; keep it equal to this. */
  flex: 0 0
    ${({ $half }) => ($half ? "calc(50% - var(--gutter-dashboard) / 2)" : "100%")};
  height: ${({ $height }) => $height}px;
  ${highlightStyle}
`;

const MobileCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
  /* Off the spacing ladder: a header height, not an inset. The 32 -> 24 snap
     would clip ReorderBtn below (28x24 plus a 1px border, so 26px of box) top
     and bottom, and drop a mobile-only touch target from 32px to 24px. Move
     it only together with that button. */
  height: 32px;
  flex-shrink: 0;
  background: var(--color-surface-panel);
  border-radius: var(--radius-regular) var(--radius-regular) 0 0;
  padding: var(--inset-tile-header);

  @media (pointer: coarse) {
    height: auto;
    min-height: 44px;
  }
`;

const MobileCellHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
  flex: 1;
`;

/* The tray gap, not --gap-related: five glyph buttons ride this tray, each already
   carrying its own 2px margin, and on a half-width cell the widget's name has
   the rest of the row. The default gap would take 32px of that name away. */
const MobileCellHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-glyph-tray);
  flex-shrink: 0;
`;

const MobileCellName = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

/* Same sub-floor glyph chrome as the remove and push buttons it sits beside;
   see the note over RemoveBtn in shared.tsx for why the inset is the compact
   name rather than --inset-control. */
