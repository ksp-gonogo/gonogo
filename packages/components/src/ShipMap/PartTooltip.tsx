import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, resourceColor, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { PartActionCount } from "./PartActionMenu";
import { METER_STATUS_COLOR } from "./partMeters";
import type {
  ShipMapPart,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "./shipTopology";

/** The hovered part's facts, its contributed meters and status rows, and a raw row for any resource no meter covers. */
export function PartTooltip({
  hovered,
  meters,
  meta,
  mouse,
  width,
  height,
  showActionCount,
}: {
  hovered: ShipMapPart;
  /** The same `partMeters` list the in-body bars read, rendered through ui-kit's `<Meter>`. */
  meters: readonly ShipMapPartMeterEntry[];
  meta: readonly ShipMapPartMetaEntry[];
  mouse: { x: number; y: number };
  width: number;
  height: number;
  showActionCount: boolean;
}) {
  const meteredResourceNames = new Set(meters.map((m) => m.resource));
  const otherResources =
    hovered.resources?.filter((r) => !meteredResourceNames.has(r.n)) ?? [];
  return (
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
      {showActionCount ? <PartActionCount flightId={hovered.flightId} /> : null}
      {meters.map((m) => (
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
                  outline: `1px solid ${METER_STATUS_COLOR[m.status]}`,
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
      {meta.map((m) =>
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
  );
}

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
