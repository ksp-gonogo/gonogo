import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, resourceColor, TextButton, Unit } from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useZoomPan } from "../shared/useZoomPan";
import { anchoredMenuPosition } from "./anchoredMenuPosition";
import { PartActionCount, PartActionMenu } from "./PartActionMenu";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";

const NO_METERS: readonly ShipMapPartMeterEntry[] = [];
const NO_META: readonly ShipMapPartMetaEntry[] = [];

/** Status as an outline around the compact meter, never the fill hue: the same split as `ShipDiagramSvg`'s `STATUS_BORDER`. */
const STATUS_OUTLINE: Record<"low" | "critical", string> = {
  low: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

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
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  // The open part and its anchor, held together so the menu never renders without a position. Canvas-local for re-placement, viewport for the portalled menu's first paint.
  const [openPart, setOpenPart] = useState<{
    part: ShipMapPart;
    anchor: { x: number; y: number };
    viewportAnchor: { x: number; y: number };
  } | null>(null);
  // Measured before paint and again when the menu resizes: the action list arrives a light-time after it opens.
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // Restored on dismiss so Escape returns focus to the part.
  const triggerRef = useRef<Element | null>(null);

  const dismissMenu = () => {
    setOpenPart(null);
    setMenuPos(null);
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

  // A layout effect so the measured position is the first on screen, not a visible jump.
  useLayoutEffect(() => {
    if (!openPart || !menuHost) return;
    const place = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const menuRect = menuHost.getBoundingClientRect();
      const next = anchoredMenuPosition(
        {
          x: wrapperRect.left + openPart.anchor.x,
          y: wrapperRect.top + openPart.anchor.y,
        },
        { w: menuRect.width, h: menuRect.height },
        { w: window.innerWidth, h: window.innerHeight },
      );
      setMenuPos((prev) =>
        prev && prev.left === next.left && prev.top === next.top ? prev : next,
      );
    };
    place();
    // The menu grows when its actions land, and the window and dashboard both scroll the part away: all three re-place.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(menuHost);
    window.addEventListener("resize", place);
    // Capture phase: the dashboard scrolls an inner container, not the window, and scroll events from those do not bubble.
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [openPart, menuHost, wrapperRef]);

  const onWrapperMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // The same `partMeters` list the in-body bars read, rendered through ui-kit's `<Meter>` like every other meter-bearing widget.
  const hoveredMeters = hovered
    ? (partMeters?.get(String(hovered.flightId)) ?? NO_METERS)
    : NO_METERS;
  const hoveredMeta = hovered
    ? (partMeta?.get(String(hovered.flightId)) ?? NO_META)
    : NO_META;
  // Resources with no contributed meter still get a plain raw row.
  const meteredResourceNames = new Set(hoveredMeters.map((m) => m.resource));
  const otherResources =
    hovered?.resources?.filter((r) => !meteredResourceNames.has(r.n)) ?? [];

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
        onPartFocus={(_, center) => setMouse(center)}
        // Only with a command surface; a static render passes none.
        onPartActivate={
          onInvokePartAction
            ? (part, anchor) => {
                triggerRef.current = document.activeElement;
                const rect = wrapperRef.current?.getBoundingClientRect();
                setMenuPos(null);
                setOpenPart({
                  part,
                  anchor,
                  viewportAnchor: {
                    x: (rect?.left ?? 0) + anchor.x,
                    y: (rect?.top ?? 0) + anchor.y,
                  },
                });
              }
            : undefined
        }
        partMeters={partMeters}
      />

      {hovered && (
        <div
          style={{
            ...TOOLTIP,
            left: Math.min(mouse.x + 12, Math.max(0, width - 180)),
            top: Math.min(mouse.y + 12, Math.max(0, height - 80)),
          }}
        >
          <div style={TOOLTIP_TITLE}>{hovered.title || hovered.name}</div>
          <div style={TOOLTIP_ROW}>
            <span>type</span>
            <span style={TOOLTIP_ROW_VALUE}>{hovered.type}</span>
          </div>
          <div style={TOOLTIP_ROW}>
            <span>mass</span>
            <span style={TOOLTIP_ROW_VALUE}>
              <Unit value={value("t", hovered.dryMass)} decimals={3} />
            </span>
          </div>
          {hovered.temperatureK !== undefined &&
          (hovered.maxTemperatureK ?? hovered.maxTemp) > 0 ? (
            <div style={TOOLTIP_ROW}>
              <span>temp</span>
              <span style={TOOLTIP_ROW_VALUE}>
                {Math.round(hovered.temperatureK)} /{" "}
                {Math.round(hovered.maxTemperatureK ?? hovered.maxTemp)} K
              </span>
            </div>
          ) : null}
          <div style={TOOLTIP_ROW}>
            <span>stage</span>
            <span style={TOOLTIP_ROW_VALUE}>{hovered.stage}</span>
          </div>
          {/* Mounting is the subscription that makes the mod enumerate the part's PAW, so only for the hovered part. */}
          {onInvokePartAction ? (
            <PartActionCount flightId={hovered.flightId} />
          ) : null}
          {hoveredMeters.map((m) => (
            <Meter
              key={`meter-${m.resource}`}
              label={m.displayName}
              /* Handed over as they arrived: `Meter` marks a held figure and places a band, which a bare quantity would strip. */
              value={m.amount}
              capacity={m.capacity}
              fillColor={resourceColor(m.resource)}
              style={
                m.status
                  ? {
                      outline: `1px solid ${STATUS_OUTLINE[m.status]}`,
                      outlineOffset: "2px",
                    }
                  : undefined
              }
            />
          ))}
          {otherResources.map((r) => (
            <div style={TOOLTIP_ROW} key={r.n}>
              <span>{r.n}</span>
              <span style={TOOLTIP_ROW_VALUE}>
                <Unit value={value("units", r.a)} decimals={0} />
                {" / "}
                <Unit value={value("units", r.c)} decimals={0} />
              </span>
            </div>
          ))}
          {hoveredMeta.map((m) =>
            m.kind === "ratio" ? (
              <Meter
                key={`meta-${m.label}`}
                label={m.label}
                value={m.value == null ? null : value("ratio", m.value)}
                tone={m.tone}
              />
            ) : (
              <div style={TOOLTIP_ROW} key={`meta-${m.label}`}>
                <span>{m.label}</span>
                <span style={TOOLTIP_ROW_VALUE}>{m.text}</span>
              </div>
            ),
          )}
        </div>
      )}

      {openPart && onInvokePartAction
        ? // Portalled to the body because the Panel clips with overflow hidden, at the popover rung of the z-index ladder.
          createPortal(
            <div
              ref={setMenuHost}
              style={{
                ...MENU_HOST,
                // The unmeasured first guess, replaced by the measured, clamped position before paint.
                left: menuPos?.left ?? openPart.viewportAnchor.x + 12,
                top: menuPos?.top ?? openPart.viewportAnchor.y + 12,
              }}
            >
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
                // The host box positions; the menu goes back in flow so the host can be measured.
                style={MENU_IN_HOST}
              />
            </div>,
            document.body,
          )
        : null}
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
  // Local ordering inside Root, below the Tooltip's 20.
  zIndex: 10,
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-control)",
  background: "var(--color-surface-raised)",
  color: "var(--color-status-go-fg)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
  textDecoration: "none",
};

// Fixed to the viewport, since the coordinates come from `getBoundingClientRect`.
const MENU_HOST: CSSProperties = {
  position: "fixed",
  // `position: fixed` makes this host its own stacking context, so the rung must sit here or the diagram svg's local z-index paints over the menu.
  zIndex: "var(--z-dropdown)",
};

// Static, not the menu's own absolute, so it stays in the host's flow and the host can be measured.
const MENU_IN_HOST: CSSProperties = { position: "static" };

const TOOLTIP: CSSProperties = {
  position: "absolute",
  background: "var(--color-surface-sunken)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
  pointerEvents: "none",
  minWidth: "140px",
  // Local pair with ResetButton, both inside Root.
  zIndex: 20,
};

const TOOLTIP_TITLE: CSSProperties = {
  fontWeight: 600,
  color: "var(--color-status-go-fg)",
  marginBottom: "var(--gap-under-title)",
  wordBreak: "break-word",
};

const TOOLTIP_ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--gap-section)",
  color: "var(--color-text-muted)",
};

const TOOLTIP_ROW_VALUE: CSSProperties = { color: "var(--color-text-primary)" };
