import type {
  AnyBoundCommand,
  PartPanelDefinition,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Floating,
  IconButton,
  LiveRegion,
  LockScope,
  ModalProvider,
  PanZoomViewport,
  RotateAnticlockwiseIcon,
  RotateClockwiseIcon,
  useElementSize,
  useModal,
  usePanZoom,
} from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TransferResourceOption } from "./PartActionMenu";
import { PartTooltip } from "./PartTooltip";
import { type FieldCommandHandle, PartWindow } from "./PartWindow";
import { NO_METERS } from "./partMeters";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type {
  VesselSchematicPart,
  VesselSchematicPartActionEntry,
  VesselSchematicPartMetaEntry,
  VesselSchematicPartMeterEntry,
} from "./shipTopology";
import type { TransferDrawing } from "./TransferLayer";
import { usePartActions } from "./usePartActions";

const NO_META: readonly VesselSchematicPartMetaEntry[] = [];
const NO_ACTIONS: readonly VesselSchematicPartActionEntry[] = [];

interface Props {
  parts: readonly VesselSchematicPart[];
  /** Stringified flightId of the one part to ring. An id, not a name: a symmetric craft has several parts under one name. */
  highlightPartId?: string | null;
  highlightColor?: string;
  width: number;
  height: number;
  /** Current throttle (0..1+), gating engine flames. */
  throttle?: number;
  /** True while the vessel makes thrust, which lights a solid booster at any throttle. */
  thrusting?: boolean;
  /** Per-part resource meters keyed by stringified flightId: in-body bars in the SVG, real `<Meter>`s in the tooltip. */
  partMeters?: ReadonlyMap<string, readonly VesselSchematicPartMeterEntry[]>;
  /** Per-part status rows, same keying as `partMeters`. Tooltip only. */
  partMeta?: ReadonlyMap<string, readonly VesselSchematicPartMetaEntry[]>;
  /** Per-part buttons contributed to `vessel-schematic.part-actions`, same keying as `partMeters`. Listed in the part's menu after the game's own and counted in its tooltip. */
  partActions?: ReadonlyMap<string, readonly VesselSchematicPartActionEntry[]>;
  /** The command one contributed button sends, or null where its command has no handle mounted. The widget owns the handle so it outlives the menu. */
  contributedActionCommand?: (
    entry: VesselSchematicPartActionEntry,
    partTitle: string,
  ) => AnyBoundCommand | null;
  /**
   * The command one PAW action on one part sends. The widget owns the
   * `useCommand` handle so it outlives this popover. Omitted, the part-action
   * affordances do not appear.
   */
  partActionCommand?: (
    flightId: number,
    eventName: string,
    actionLabel: string,
    partTitle: string,
    moduleIndex?: number | null,
  ) => AnyBoundCommand;
  /** The handle `vessel.setPartField` is sent on, owned by the widget so a control's sent word outlives the window. */
  setPartField?: FieldCommandHandle;
  /** Presses of the rotate control the view is turned from its default. */
  turn?: number;
  /** Sets the turn. Omitted, the rotate control does not appear. */
  onTurn?: (turn: number) => void;
  /** Tank marks and running transfers to draw. */
  transferDrawing?: TransferDrawing;
  /** While picking tanks, a press on a part chooses it instead of opening its menu. */
  onPickTank?: (part: VesselSchematicPart) => void;
  /** True once the craft is destroyed: its last parts stay drawn, but a part window of it is closed. */
  destroyed?: boolean;
  /** The line saying why a part window closed, owned by the caller so it outlives a redraw of the diagram, and the way to set or clear it. */
  closedNotice?: string | null;
  onClosedNotice?: (notice: string | null) => void;
  /** The resources a part's menu offers for transfer. */
  transferResourcesOf?: (
    part: VesselSchematicPart,
  ) => readonly TransferResourceOption[];
  /** A resource was chosen in a part's menu. */
  onStartTransferPick?: (part: VesselSchematicPart, resource: string) => void;
}

/** The diagram is too small to hold the rotate control beside the reset one under this width, in px. */
export const ROTATE_MIN_WIDTH = 220;

/**
 * A provider of its own rather than the app's: the app's sits above the
 * telemetry, screen and Domain providers, and a dialog's content sees the
 * context around the provider that drew it. Under this one, a part panel reads
 * the widget's own store, so its figures and their delay match the widget's.
 */
export function ShipDiagram(props: Readonly<Props>) {
  return (
    <ModalProvider>
      <ShipDiagramBody {...props} />
    </ModalProvider>
  );
}

function ShipDiagramBody({
  parts,
  highlightPartId,
  highlightColor,
  width,
  height,
  throttle,
  thrusting,
  partMeters,
  partMeta,
  partActions,
  contributedActionCommand,
  partActionCommand,
  setPartField,
  turn = 0,
  onTurn,
  transferDrawing,
  onPickTank,
  destroyed = false,
  closedNotice = null,
  onClosedNotice,
  transferResourcesOf,
  onStartTransferPick,
}: Readonly<Props>) {
  const [hovered, setHovered] = useState<VesselSchematicPart | null>(null);
  const [openClusterId, setOpenClusterId] = useState<string | null>(null);
  // In viewport coordinates, where the portalled tooltip is placed.
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  // The open part and its canvas-local anchor, re-read against the canvas on every re-place so the menu follows a scrolled part.
  const [openPart, setOpenPart] = useState<{
    part: VesselSchematicPart;
    anchor: { x: number; y: number };
  } | null>(null);
  // Restored on dismiss so Escape returns focus to the part.
  const triggerRef = useRef<Element | null>(null);
  const { open: openModal, close: closeModal } = useModal();
  const openPanelRef = useRef<{ modalId: string; flightId: number } | null>(
    null,
  );
  const openPartPanel = (
    panel: PartPanelDefinition,
    part: VesselSchematicPart,
  ) => {
    const partTitle = part.title || part.name;
    const Content = panel.component;
    const close = () => {
      if (openPanelRef.current) closeModal(openPanelRef.current.modalId);
    };
    const modalId = openModal(
      <LockScope>
        <Content
          partId={String(part.flightId)}
          partTitle={partTitle}
          close={close}
        />
      </LockScope>,
      {
        title: `${panel.title} \u00b7 ${partTitle}`,
        titleAdornment: panel.titleAdornment,
        width: panel.width,
      },
    );
    openPanelRef.current = { modalId, flightId: part.flightId };
  };
  // An empty list is a craft not yet known, never a part that has left.
  useEffect(() => {
    const opened = openPanelRef.current;
    if (!opened || parts.length === 0) return;
    if (parts.some((p) => p.flightId === opened.flightId)) return;
    closeModal(opened.modalId);
    openPanelRef.current = null;
  }, [parts, closeModal]);

  const setClosedNotice = useCallback(
    (notice: string | null) => onClosedNotice?.(notice),
    [onClosedNotice],
  );
  // A part window whose part has left the craft (a stage separated, or the craft was lost) is closed, and a line says why.
  useEffect(() => {
    if (!openPart) return;
    const title = openPart.part.title || openPart.part.name;
    if (destroyed) {
      setOpenPart(null);
      setClosedNotice(
        `The vessel was destroyed, so the ${title} window closed.`,
      );
      return;
    }
    if (parts.length === 0) return;
    if (parts.some((p) => p.flightId === openPart.part.flightId)) return;
    setOpenPart(null);
    setClosedNotice(`The ${title} left the vessel, so its window closed.`);
  }, [parts, openPart, destroyed, setClosedNotice]);

  // The reason goes as soon as another window opens; its few seconds are timed by the owner of the line, so a redraw of the diagram does not cut them short.
  useEffect(() => {
    if (openPart) setClosedNotice(null);
  }, [openPart, setClosedNotice]);

  const dismissMenu = () => {
    setOpenPart(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
      trigger.focus();
    }
  };
  const { ref: wrapperRef, size } = useElementSize({ w: width, h: height });
  const panZoom = usePanZoom({
    elementRef: wrapperRef,
    minZoom: 0.5,
    maxZoom: 12,
    panThreshold: 4,
  });
  const resetView = panZoom.reset;
  // The pan is the diagram point at the middle of the view, and the drawing is moved by a translation in pixels, from the middle of the wrapper.
  const cam = {
    zoom: panZoom.camera.zoom,
    panX:
      (size.w / 2) * (1 - panZoom.camera.zoom) -
      panZoom.camera.panX * panZoom.camera.zoom,
    panY:
      (size.h / 2) * (1 - panZoom.camera.zoom) -
      panZoom.camera.panY * panZoom.camera.zoom,
  };

  const menuAnchor = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || !openPart) return null;
    return {
      x: rect.left + openPart.anchor.x,
      y: rect.top + openPart.anchor.y,
    };
  };

  /*
   * Only the tooltip reads the pointer, so a move over no part renders nothing: the position is kept in a ref and enters state only while a part is hovered, and once as a part becomes hovered.
   */
  const pointerRef = useRef({ x: 0, y: 0 });
  const onWrapperMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (hovered) setPointer(pointerRef.current);
  };
  const hoveredId = hovered?.flightId;
  useEffect(() => {
    if (hoveredId !== undefined) setPointer(pointerRef.current);
  }, [hoveredId]);

  // The same `partMeters` list the in-body bars read, rendered through ui-kit's `<Meter>` like every other meter-bearing widget.
  const hoveredMeters = hovered
    ? (partMeters?.get(String(hovered.flightId)) ?? NO_METERS)
    : NO_METERS;
  const hoveredMeta = hovered
    ? (partMeta?.get(String(hovered.flightId)) ?? NO_META)
    : NO_META;

  return (
    <PanZoomViewport
      panZoom={panZoom}
      label="Ship diagram view"
      onMouseMove={onWrapperMouseMove}
    >
      <Button
        size="sm"
        type="button"
        onClick={() => {
          resetView();
          if (turn !== 0) onTurn?.(0);
        }}
        aria-label="Reset view"
        style={RESET_BUTTON}
      >
        Reset
      </Button>
      <LiveRegion>
        {closedNotice !== null && (
          <div style={CLOSED_NOTICE}>{closedNotice}</div>
        )}
      </LiveRegion>
      {onTurn && width >= ROTATE_MIN_WIDTH && (
        <div style={ROTATE_GROUP}>
          <IconButton
            type="button"
            onClick={() => onTurn(turn - 1)}
            aria-label="Rotate view anticlockwise"
          >
            <RotateAnticlockwiseIcon size={14} />
          </IconButton>
          <IconButton
            type="button"
            onClick={() => onTurn(turn + 1)}
            aria-label="Rotate view clockwise"
          >
            <RotateClockwiseIcon size={14} />
          </IconButton>
        </div>
      )}
      <ShipDiagramSvg
        parts={parts}
        width={width}
        height={height}
        highlightPartId={highlightPartId}
        highlightColor={highlightColor}
        cam={cam}
        throttle={throttle}
        thrusting={thrusting}
        onPartHover={setHovered}
        onPartFocus={(_, center) => {
          const rect = wrapperRef.current?.getBoundingClientRect();
          setPointer({
            x: (rect?.left ?? 0) + center.x,
            y: (rect?.top ?? 0) + center.y,
          });
        }}
        // Only with a command surface; a static render passes none.
        onPartActivate={
          onPickTank
            ? (part) => onPickTank(part)
            : partActionCommand
              ? (part, anchor) => {
                  triggerRef.current = document.activeElement;
                  setOpenPart({ part, anchor });
                }
              : undefined
        }
        partMeters={partMeters}
        transferDrawing={transferDrawing}
        openClusterId={openClusterId}
        onToggleCluster={setOpenClusterId}
      />

      {hovered && !openPart && (
        <PartTooltip
          hovered={hovered}
          meters={hoveredMeters}
          meta={hoveredMeta}
          pointer={pointer}
          showActionCount={Boolean(partActionCommand)}
          contributedActions={
            partActions?.get(String(hovered.flightId)) ?? NO_ACTIONS
          }
        />
      )}

      {/* One subscription per part for as long as the diagram is on screen, so a part opened later is already held. */}
      {partActionCommand && setPartField
        ? parts.map((part) => (
            <PartWindowSubscription
              key={part.flightId}
              flightId={part.flightId}
            />
          ))
        : null}

      {openPart && partActionCommand && setPartField && (
        <Floating anchor={menuAnchor}>
          <PartWindow
            setFieldHandle={setPartField}
            flightId={openPart.part.flightId}
            partTitle={openPart.part.title || openPart.part.name}
            commandFor={(eventName, actionLabel, moduleIndex) =>
              partActionCommand(
                openPart.part.flightId,
                eventName,
                actionLabel,
                openPart.part.title || openPart.part.name,
                moduleIndex,
              )
            }
            contributed={
              partActions?.get(String(openPart.part.flightId)) ?? NO_ACTIONS
            }
            contributedCommandFor={(entry) =>
              contributedActionCommand?.(
                entry,
                openPart.part.title || openPart.part.name,
              ) ?? null
            }
            transferResources={transferResourcesOf?.(openPart.part)}
            onPickTransfer={(resource) =>
              onStartTransferPick?.(openPart.part, resource)
            }
            onOpenPanel={(panel) => openPartPanel(panel, openPart.part)}
            onDismiss={dismissMenu}
            // The floating layer positions; the menu goes back in flow so the layer can be measured.
            style={MENU_IN_LAYER}
          />
        </Floating>
      )}
    </PanZoomViewport>
  );
}

const RESET_BUTTON: CSSProperties = {
  position: "absolute",
  top: "6px",
  left: "6px",
  // Local ordering inside Root, above the diagram svg.
  zIndex: 10,
};

const CLOSED_NOTICE: CSSProperties = {
  position: "absolute",
  bottom: "6px",
  left: "6px",
  right: "6px",
  zIndex: RESET_BUTTON.zIndex,
  padding: "var(--inset-chip-readout)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
};

const ROTATE_GROUP: CSSProperties = {
  position: "absolute",
  top: "6px",
  right: "6px",
  display: "flex",
  gap: "var(--gap-related)",
  zIndex: RESET_BUTTON.zIndex,
};

// Static, not the menu's own absolute, so it stays in the layer's flow and the layer can be measured.
const MENU_IN_LAYER: CSSProperties = { position: "static" };

/** Holds one part's window subscription, which draws nothing. */
function PartWindowSubscription({ flightId }: Readonly<{ flightId: number }>) {
  usePartActions(flightId);
  return null;
}
