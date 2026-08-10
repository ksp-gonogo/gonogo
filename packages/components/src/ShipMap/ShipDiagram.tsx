import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, resourceColor, TextButton, Unit } from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { CSSProperties } from "react";
import { useState } from "react";
import { useZoomPan } from "../shared/useZoomPan";
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
}: Readonly<Props>) {
  const [hovered, setHovered] = useState<ShipMapPart | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const {
    ref: wrapperRef,
    cam,
    reset: resetView,
    panMoved,
    pointerHandlers,
  } = useZoomPan<HTMLDivElement>();

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
