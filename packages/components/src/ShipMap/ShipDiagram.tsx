import { Floating, TextButton } from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { useZoomPan } from "../shared/useZoomPan";
import { PartActionMenu } from "./PartActionMenu";
import { PartTooltip } from "./PartTooltip";
import { NO_METERS } from "./partMeters";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";

const NO_META: readonly ShipMapPartMetaEntry[] = [];

interface Props {
  parts: readonly ShipMapPart[];
  /** Stringified flightId of the one part to ring. An id, not a name: a symmetric craft has several parts under one name. */
  highlightPartId?: string | null;
  highlightColor?: string;
  width: number;
  height: number;
  /** Current throttle (0..1+), gating engine flames. */
  throttle?: number;
  /** Per-part resource meters keyed by stringified flightId: in-body bars in the SVG, real `<Meter>`s in the tooltip. */
  partMeters?: ReadonlyMap<string, readonly ShipMapPartMeterEntry[]>;
  /** Per-part status rows, same keying as `partMeters`. Tooltip only. */
  partMeta?: ReadonlyMap<string, readonly ShipMapPartMetaEntry[]>;
  /**
   * Fires one PAW action on one part. The widget owns the `useCommand` handle
   * so it outlives this popover. Omitted, the part-action affordances do not
   * appear.
   */
  onInvokePartAction?: (
    flightId: number,
    eventName: string,
    actionLabel: string,
    partTitle: string,
  ) => void;
}

export function ShipDiagram({
  parts,
  highlightPartId,
  highlightColor,
  width,
  height,
  throttle,
  partMeters,
  partMeta,
  onInvokePartAction,
}: Readonly<Props>) {
  const [hovered, setHovered] = useState<ShipMapPart | null>(null);
  // In viewport coordinates, where the portalled tooltip is placed.
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  // The open part and its canvas-local anchor, re-read against the canvas on every re-place so the menu follows a scrolled part.
  const [openPart, setOpenPart] = useState<{
    part: ShipMapPart;
    anchor: { x: number; y: number };
  } | null>(null);
  // Restored on dismiss so Escape returns focus to the part.
  const triggerRef = useRef<Element | null>(null);

  const dismissMenu = () => {
    setOpenPart(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
      trigger.focus();
    }
  };
  const {
    ref: wrapperRef,
    cam,
    reset: resetView,
    panMoved,
    pointerHandlers,
  } = useZoomPan<HTMLDivElement>();

  const menuAnchor = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || !openPart) return null;
    return {
      x: rect.left + openPart.anchor.x,
      y: rect.top + openPart.anchor.y,
    };
  };

  const onWrapperMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    setPointer({ x: e.clientX, y: e.clientY });
  };

  // The same `partMeters` list the in-body bars read, rendered through ui-kit's `<Meter>` like every other meter-bearing widget.
  const hoveredMeters = hovered
    ? (partMeters?.get(String(hovered.flightId)) ?? NO_METERS)
    : NO_METERS;
  const hoveredMeta = hovered
    ? (partMeta?.get(String(hovered.flightId)) ?? NO_META)
    : NO_META;

  return (
    // Mouse-only pan/zoom enhancement; keyboard access is via the focusable SVG parts, and no semantic role fits a bare pan canvas.
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only pan/zoom enhancement; keyboard access is via the focusable SVG parts
    <div
      ref={wrapperRef}
      onMouseMove={onWrapperMouseMove}
      {...pointerHandlers}
      style={{
        ...WRAPPER,
        cursor: panMoved.current ? "grabbing" : "grab",
      }}
    >
      <TextButton
        type="button"
        onClick={resetView}
        aria-label="Reset view"
        style={RESET_BUTTON}
      >
        Reset
      </TextButton>
      <ShipDiagramSvg
        parts={parts}
        width={width}
        height={height}
        highlightPartId={highlightPartId}
        highlightColor={highlightColor}
        cam={cam}
        throttle={throttle}
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
          onInvokePartAction
            ? (part, anchor) => {
                triggerRef.current = document.activeElement;
                setOpenPart({ part, anchor });
              }
            : undefined
        }
        partMeters={partMeters}
      />

      {hovered && (
        <PartTooltip
          hovered={hovered}
          meters={hoveredMeters}
          meta={hoveredMeta}
          pointer={pointer}
          showActionCount={Boolean(onInvokePartAction)}
        />
      )}

      {openPart && onInvokePartAction && (
        <Floating anchor={menuAnchor}>
          <PartActionMenu
            flightId={openPart.part.flightId}
            partTitle={openPart.part.title || openPart.part.name}
            onInvoke={(eventName, actionLabel) =>
              onInvokePartAction(
                openPart.part.flightId,
                eventName,
                actionLabel,
                openPart.part.title || openPart.part.name,
              )
            }
            onDismiss={dismissMenu}
            // The floating layer positions; the menu goes back in flow so the layer can be measured.
            style={MENU_IN_LAYER}
          />
        </Floating>
      )}
    </div>
  );
}

// `cursor` (grab/grabbing) is applied at the call site from the pan state.
const WRAPPER: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  touchAction: "none",
  userSelect: "none",
};

const RESET_BUTTON: CSSProperties = {
  position: "absolute",
  top: "6px",
  left: "6px",
  // Local ordering inside Root, above the diagram svg.
  zIndex: 10,
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-control)",
  background: "var(--color-surface-raised)",
  color: "var(--color-go-text)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
  textDecoration: "none",
};

// Static, not the menu's own absolute, so it stays in the layer's flow and the layer can be measured.
const MENU_IN_LAYER: CSSProperties = { position: "static" };
