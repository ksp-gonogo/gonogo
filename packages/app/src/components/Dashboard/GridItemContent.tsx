import { type ComponentDefinition, getComponent } from "@ksp-gonogo/core";
import type { InputMappings } from "@ksp-gonogo/serial";
import { GripIcon, WidgetAtTileSize } from "@ksp-gonogo/ui";
import {
  showsTiny,
  Tooltip,
  useSizeDeltaFor,
  withSizeDelta,
} from "@ksp-gonogo/ui-kit";
import { memo, useCallback, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  getUplinkOutcomes,
  haveUplinksSettled,
  subscribeUplinkOutcomes,
} from "../../uplinks/loaderState";
import {
  ExpandButton,
  type Expansion,
  ExpansionHost,
  useExpansion,
} from "./Expansion";
import type { DashboardItem } from "./index";
import { ComponentWrapper, PushButton, RemoveButton } from "./shared";
import { WidgetProviders, WidgetShell } from "./TileWidget";
import { UnavailableWidget } from "./UnavailableWidget";
import { GearButton, GearWrapper } from "./WidgetGearMenu";

interface GridItemContentProps {
  item: DashboardItem;
  w: number | undefined;
  h: number | undefined;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
}

// GridItemContent: memoised per-item subtree so a sibling re-render
// (e.g. one widget's useDataValue firing on a telemetry tick) doesn't
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
  // The registry does not notify, and an Uplink's client can load after the first render, so a load outcome is what says to look again.
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

  if (!def) {
    // An Uplink's widgets register once its client loads, so nothing is drawn while one is still loading.
    if (uplinkOutcomes.some((o) => o.status === "loading")) return null;
    return (
      <>
        <Tooltip text="Drag to reposition" announce={false} placement="above">
          <CellHeader className="drag-handle">
            <GripIcon size={12} />
          </CellHeader>
        </Tooltip>
        <ComponentWrapper>
          <UnavailableWidget
            componentId={item.componentId}
            settled={uplinksSettled}
            onRemove={onRemove}
          />
        </ComponentWrapper>
      </>
    );
  }
  const tileProps: TileProps = {
    def,
    item,
    w,
    h,
    onSaveConfig,
    onSaveMappings,
    onRemove,
    updateItemConfig,
  };
  return def.expandable === true ? (
    <ExpandableTile {...tileProps} />
  ) : (
    <TileContent {...tileProps} />
  );
});

interface TileProps {
  def: ComponentDefinition;
  item: DashboardItem;
  w: number | undefined;
  h: number | undefined;
  onSaveConfig: (next: Record<string, unknown>) => void;
  onSaveMappings: (next: InputMappings) => void;
  onRemove: () => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
}

/**
 * A tile of a widget registered with `expandable`: the same tile with an Expand
 * button, its widget drawn through a host node that moves into the dialog. Kept
 * apart from {@link TileContent} so the dialog hook is only called for a widget
 * that can be expanded.
 */
function ExpandableTile(props: Readonly<TileProps>) {
  const expansion = useExpansion({ name: props.def.name });
  return <TileContent {...props} expansion={expansion} />;
}

function TileContent({
  def,
  item,
  w: tileW,
  h: tileH,
  onSaveConfig,
  onSaveMappings,
  onRemove,
  updateItemConfig,
  expansion,
}: Readonly<TileProps & { expansion?: Expansion }>) {
  const sizeDeltaFor = useSizeDeltaFor();
  const w = expansion?.size?.w ?? tileW;
  const h = expansion?.size?.h ?? tileH;
  // The room the extensions rendering here ask for moves where the widget stops showing its tiny form.
  const sizedDef = withSizeDelta(def, sizeDeltaFor(def));
  const declaredConfig = item.config ?? def.defaultConfig ?? {};
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  const widget = (
    <WidgetShell
      def={def}
      item={item}
      config={declaredConfig}
      updateItemConfig={updateItemConfig}
      title={def.name}
      compact={
        sizedDef.tiny !== undefined && showsTiny(sizedDef, w, h)
          ? { title: sizedDef.tiny.title }
          : undefined
      }
    >
      <WidgetAtTileSize
        def={sizedDef}
        id={item.i}
        config={item.config}
        w={w}
        h={h}
        onConfigChange={onSaveConfig}
      />
    </WidgetShell>
  );

  return (
    <WidgetProviders def={def} config={declaredConfig}>
      <Tooltip text="Drag to reposition" announce={false} placement="above">
        <CellHeader className="drag-handle">
          <GripIcon size={12} />
          {/* widget-action-buttons: draggableCancel target so touch events don't trigger drag */}
          <ActionButtons className="widget-action-buttons">
            {expansion && (
              <ExpandButton expansion={expansion} name={def.name} />
            )}
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
              w={tileW ?? 3}
              h={tileH ?? 3}
            />
            <RemoveButton onRemove={onRemove} name={def.name} />
          </ActionButtons>
        </CellHeader>
      </Tooltip>
      <ComponentWrapper>
        {expansion ? (
          <ExpansionHost
            expansion={expansion}
            pushButton={
              <PushButton
                item={item}
                pushable={def.pushable === true}
                w={w ?? 3}
                h={h ?? 3}
              />
            }
          >
            {widget}
          </ExpansionHost>
        ) : (
          widget
        )}
      </ComponentWrapper>
    </WidgetProviders>
  );
}

const CellHeader = styled.div`
  /* Off the spacing ladder: this is the drag-handle height, and the 18 -> 16
     snap would compound with the font tokens on its children. The tallest is
     PushBtn (shared.tsx): --font-size-sm + line-height 1 + the 1px 4px of
     --inset-control-compact is 14px of box on a desktop but 15px on a coarse
     pointer, which is the tier-1 Steam Deck. 15px inside 18px is fine; inside
     16px it leaves 0.5px per side on the primary drag affordance, which is
     also why that inset's vertical is 1px and not 2. Grow this before
     shrinking it. */
  height: 18px;
  /* In the gap above the tile, so it covers no widget content. */
  position: absolute;
  top: -18px;
  left: 0;
  right: 0;
  background: var(--color-surface-panel);
  cursor: grab;
  flex-shrink: 0;
  border-radius: var(--radius-regular) var(--radius-regular) 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--inset-tile-header);

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
  /* Lift above the resize handles (z-index 5). The top-right "ne" handle
     overlaps this tray; without this its invisible hit zone would swallow
     taps meant for the gear/push/remove buttons. The gear modal portals to
     body, so this stacking context doesn't trap it. */
  position: relative;
  z-index: 6;
`;
