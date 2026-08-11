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

/**
 * `ShipMapPartMeterEntry.status` -> an outline colour, the SAME split as
 * `ShipDiagramSvg`'s own `STATUS_BORDER`: a resource meter's fill is its
 * identity colour (`resourceColor`) regardless of level, status is drawn as
 * a separate ring around the compact meter rather than blended into the
 * fill hue (design doc: local_docs/design/2026-08-08-resource-colour-
 * system.md, gonogo main repo).
 */
const STATUS_OUTLINE: Record<"low" | "critical", string> = {
  low: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

interface Props {
  parts: readonly ShipMapPart[];
  /**
   * Case-insensitive part name or title to highlight (typically
   * `therm.hottestPartName`). Matched against both `name` and `title`.
   */
  highlight?: string | null;
  highlightColor?: string;
  width: number;
  height: number;
  /** Current `f.throttle` (0..1+). Forwarded to ShipDiagramSvg so
   *  engine-flame overlays gate on actual thrust. */
  throttle?: number;
  /** Per-part resource meters (spec §13.4 self-contribution), keyed by
   *  `ShipMapPart.flightId` (stringified). Forwarded to `ShipDiagramSvg`
   *  for the compact in-body fill bars, and read here to render the SAME
   *  entries as real `<Meter>`s in the hover tooltip. */
  partMeters?: ReadonlyMap<string, readonly ShipMapPartMeterEntry[]>;
  /** Per-part status/metadata rows (spec §13.4), same keying as
   *  `partMeters`. Rendered only in the hover tooltip, ShipDiagramSvg has
   *  no compact-body equivalent for these. */
  partMeta?: ReadonlyMap<string, readonly ShipMapPartMetaEntry[]>;
  /**
   * Fires one PAW action on one part. Supplied by the widget (which owns the
   * `useCommand` handle so it outlives this popover, see
   * `PartActionMenuProps.onInvoke`). Omitted in the harness / snapshot renders,
   * which pass no command surface at all: without it the part-action affordances
   * simply do not appear, so a static render is unchanged.
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
  highlight,
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
  // The part whose action menu is open, plus where to anchor it. Held together
  // so the menu can never render without a position. The anchor is kept in BOTH
  // spaces: canvas-local (what the diagram reports, and what re-placement
  // recomputes from when the page scrolls) and viewport (what the portalled
  // menu is actually positioned with, so its first paint already lands on the
  // part rather than at the corner of the window).
  const [openPart, setOpenPart] = useState<{
    part: ShipMapPart;
    anchor: { x: number; y: number };
    viewportAnchor: { x: number; y: number };
  } | null>(null);
  // The portalled menu's host box, and where it sits. `null` until the first
  // measurement, which happens in a layout effect (so before paint) and then
  // again whenever the menu's own size changes: the action list arrives a
  // light-time after the menu opens, so the menu it was first placed for is
  // shorter than the one the operator ends up reading.
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // Whatever had focus when the menu opened (the part's own <g>, when opened by
  // keyboard). Restored on dismiss so Escape returns the operator to the part
  // they were on instead of dropping focus to the document body.
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

  // Re-place the portalled menu against the viewport once it can be measured.
  // A layout effect, not a passive one: it runs before the browser paints, so
  // the corrected position is the first one on screen rather than a visible
  // jump from the unmeasured guess the render above starts with.
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
    // The menu grows when its actions land; the window and the dashboard both
    // move the part out from under a fixed-position menu. All three re-place.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(menuHost);
    window.addEventListener("resize", place);
    // Capture phase: the dashboard scrolls an inner container, not the window,
    // and scroll events from those do not bubble.
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

  // The hovered part's contributed rows (spec §13.4): rendered here through
  // the real ui-kit `<Meter>`, the SAME component ShipSystems and every other
  // meter-bearing widget uses, so a contributed reading and a built-in one
  // look like one system rather than two. `ShipDiagramSvg`'s compact in-body
  // bars read the identical `partMeters` map (passed straight through
  // above); this is the OTHER rendering of that one aggregated list, not a
  // second data path.
  const hoveredMeters = hovered
    ? (partMeters?.get(String(hovered.flightId)) ?? NO_METERS)
    : NO_METERS;
  const hoveredMeta = hovered
    ? (partMeta?.get(String(hovered.flightId)) ?? NO_META)
    : NO_META;
  // Resources with no contributed meter still get the plain raw row they
  // always had, full transparency isn't lost just because a resource didn't
  // earn a bar.
  const meteredResourceNames = new Set(hoveredMeters.map((m) => m.resource));
  const otherResources =
    hovered?.resources?.filter((r) => !meteredResourceNames.has(r.n)) ?? [];

  return (
    // Mouse pan/zoom surface only (drag to pan, wheel to zoom): a progressive
    // enhancement over the keyboard-accessible content, which is the focusable
    // SVG parts inside (each a <g> with its own focus ring). No semantic role
    // fits a bare pan canvas, so the interaction stays on the div. The styled.div
    // this replaced hid it from this a11y lint.
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
      {/* TextButton for its :focus-visible ring (identical to the styled
          ResetButton's); the bordered look is inline. The styled hover also
          swapped the background, which inline can't express. */}
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
        highlight={highlight}
        highlightColor={highlightColor}
        cam={cam}
        throttle={throttle}
        onPartHover={setHovered}
        onPartFocus={(_, center) => setMouse(center)}
        // Only offered when the widget supplied a command surface: a harness /
        // snapshot render passes none, so parts stay non-activating there.
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
          {/* The WW spec's discoverability line. Mounted only when the widget
              can actually act, and only for the hovered part: mounting IS the
              subscription that makes the mod enumerate that part's PAW. */}
          {onInvokePartAction ? (
            <PartActionCount flightId={hovered.flightId} />
          ) : null}
          {hoveredMeters.map((m) => (
            <Meter
              key={`meter-${m.resource}`}
              label={m.displayName}
              value={m.capacity > 0 ? m.amount / m.capacity : 0}
              valueLabel={`${m.amount.toFixed(1)} / ${m.capacity.toFixed(1)}`}
              fillColor={resourceColor(m.resource)}
              size="sm"
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
                {r.a.toFixed(0)} / {r.c.toFixed(0)}
              </span>
            </div>
          ))}
          {hoveredMeta.map((m) =>
            m.kind === "ratio" ? (
              <Meter
                key={`meta-${m.label}`}
                label={m.label}
                value={m.value ?? 0}
                tone={m.tone}
                size="sm"
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
        ? // Portalled to the document body, the same mechanism the app's Modal
          // uses, because the menu has to draw OUTSIDE this widget: the Panel
          // around it clips with `overflow: hidden`, so on a small tile a menu
          // taller than the canvas lost its lower items, and the clip sat
          // outside the menu's own scroll box so nothing could reveal them.
          // Drawn at the popover rung of the z-index ladder (the same rung the
          // menu declares for itself in-flow), which clears the dashboard grid
          // while staying under the FAB column and any modal.
          createPortal(
            <div
              ref={setMenuHost}
              style={{
                ...MENU_HOST,
                // The unmeasured first guess: the anchor plus the same offset
                // the in-widget version used. The layout effect above replaces
                // it with the measured, viewport-clamped position before paint.
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
                // Positioning belongs to the host box now: the menu itself goes
                // back in flow so the host wraps it and can be measured.
                style={MENU_IN_HOST}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// Structural inline styles (CSS-var tokens): a bespoke pan/zoom diagram frame +
// tooltip, no reusable ui-kit primitive fits, so the layout stays local. The
// tooltip's `.title` / `.row` / `.row span:last-child` descendant rules lift
// inline onto each element at the call site.

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
  // Off the app z-index ladder: local ordering inside Root, paired with the
  // Tooltip's 20 below. Only the relative order matters.
  zIndex: 10,
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-2) var(--space-8)",
  background: "var(--color-surface-raised)",
  color: "var(--color-status-go-fg)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-xs)",
  textDecoration: "none",
};

// The portalled action menu's host box: fixed to the viewport, since its
// coordinates come from `getBoundingClientRect`, which is viewport-relative.
const MENU_HOST: CSSProperties = {
  position: "fixed",
  // The popover rung of the app's ladder, and it has to sit HERE rather than on
  // the menu: `position: fixed` makes this host its own stacking context, so a
  // rung declared inside it is trapped there, and any widget's own local
  // `z-index` (the ship diagram's svg carries 1) then paints over the menu.
  // Held as the token rather than its value so the ladder stays stated once;
  // `zIndex` is typed as a number, hence the assertion to pass the var through.
  zIndex: "var(--z-dropdown, 200)" as unknown as CSSProperties["zIndex"],
};

// Positioning is the host's job now, and so is the rung. Static rather than the
// menu's own `absolute` so it stays in the host's flow: an out-of-flow menu
// would collapse the very box there is to measure.
const MENU_IN_HOST: CSSProperties = { position: "static" };

const TOOLTIP: CSSProperties = {
  position: "absolute",
  background: "var(--color-surface-sunken)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-6) var(--space-8)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-xs)",
  pointerEvents: "none",
  minWidth: "140px",
  // Off the app z-index ladder: the upper half of the local pair with
  // ResetButton above, both inside Root.
  zIndex: 20,
};

const TOOLTIP_TITLE: CSSProperties = {
  fontWeight: 600,
  color: "var(--color-status-go-fg)",
  marginBottom: "var(--space-4)",
  wordBreak: "break-word",
};

const TOOLTIP_ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-12)",
  color: "var(--color-text-muted)",
};

// The `.row span:last-child` highlight, applied to each row's value span.
const TOOLTIP_ROW_VALUE: CSSProperties = { color: "var(--color-text-primary)" };
