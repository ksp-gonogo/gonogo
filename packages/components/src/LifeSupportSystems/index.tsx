import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter } from "@ksp-gonogo/ui";
import {
  Badge,
  Panel,
  Section,
  speakQuantity,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { magnitudeOr, type Quantityish } from "../shared/magnitude";
// Side-effect import: registers the built-in `life-support.sections`
// augment filler (the Greenhouse section) and the SlotRegistry declaration
// merge, see that file's own doc comment. Registering it here (rather than
// requiring a separate package import) keeps the slot non-empty out of the
// box, matching this widget's own "Kerbalism is the built-in source, not an
// optional third-party Uplink" posture (unlike PowerSystems' still-unfilled
// `power-systems.sections`, which genuinely waits on a separate Uplink).
import "./GreenhouseSection";
import type { GreenhouseRow } from "./GreenhouseSection";

type LifeSupportConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// Reads the real KerbalismUplink `kerbalism.lifesupport` Topic (canonical
// one-arg useTelemetry). The presentation below is a pure function of
// `LifeSupportData`, so the offline snapshot harness feeds the same shape (see
// widgetDomSnapshot's kerbalism reshape). This hook is the only data boundary.
// ---------------------------------------------------------------------------

interface Consumable {
  amount: number;
  capacity: number;
  /** Units per second. Negative = draining, positive = filling. */
  rate: number;
}

type ProcessRunState = "idle" | "running" | "broken";

interface ProcessRow {
  /** The process resource id (unique React key), e.g. "_VacScrubber". */
  id: string;
  /** Display title, e.g. "Vac Scrubber". */
  name: string;
  state: ProcessRunState;
  capacity: number;
}

interface LifeSupportData {
  food: Consumable;
  water: Consumable;
  oxygen: Consumable;
  ec: Consumable;
  pressurized: boolean;
  co2Poisoning: number;
  comfort: number;
  livingSpace: number;
  processes: ProcessRow[];
  /** Active Greenhouse parts, if any, see `GreenhouseSection`'s own doc comment. */
  greenhouses: GreenhouseRow[];
}

interface WireResource {
  amount?: Quantityish;
  capacity?: Quantityish;
  rate?: Quantityish;
}

function consumable(r: WireResource | undefined): Consumable {
  return {
    amount: magnitudeOr(r?.amount, 0),
    capacity: magnitudeOr(r?.capacity, 0),
    rate: magnitudeOr(r?.rate, 0),
  };
}

interface WireProcess {
  resource?: string;
  title?: string;
  capacity?: Quantityish;
  running?: boolean;
  broken?: boolean;
}

/**
 * Map ONE live process to a display row, PROCESS-AGNOSTIC: whatever the profile
 * carries (stock Scrubber/WaterRecycler/…, ROKerbalism _PressureControlOxygen/
 * _NonRegenScrubber/_Scrubber/_VacScrubber/_AdvScrubber, or any future set) is
 * rendered as-is from the data. Deliberately NOT a fixed stock id lookup, that
 * dropped 4 of 5 RO processes (audit 2026-07-22, DECISIONS §RO "resource-agnostic").
 */
function toProcessRow(p: WireProcess, index: number): ProcessRow {
  return {
    id: p.resource || p.title || `process-${index}`,
    name: p.title || p.resource || "Process",
    state: p.broken ? "broken" : p.running ? "running" : "idle",
    capacity: magnitudeOr(p.capacity, 0),
  };
}

interface WireGreenhouse {
  cropResource?: string;
  foodRatePerSec?: Quantityish;
  natural?: Quantityish;
  artificial?: Quantityish;
  active?: boolean;
  issue?: string;
}

/**
 * Maps ONE wire greenhouse entry to the slot-props shape, defaulting an
 * absent field rather than dropping the entry, matches `consumable`'s own
 * "missing key defaults to 0" convention above.
 */
function toGreenhouseRow(g: WireGreenhouse): GreenhouseRow {
  return {
    cropResource: g.cropResource || "Food",
    natural: magnitudeOr(g.natural, 0),
    artificial: magnitudeOr(g.artificial, 0),
    active: g.active ?? false,
    issue: g.issue ?? "",
    foodRatePerSec: magnitudeOr(g.foodRatePerSec, 0),
  };
}

function useLifeSupport(): LifeSupportData {
  const t = useTelemetry("kerbalism.lifesupport");
  return {
    food: consumable(t?.food),
    water: consumable(t?.water),
    oxygen: consumable(t?.oxygen),
    ec: consumable(t?.electricCharge),
    pressurized: magnitudeOr(t?.habitat?.pressure, 0) > 0.5,
    co2Poisoning: magnitudeOr(t?.habitat?.poisoning, 0),
    comfort: magnitudeOr(t?.habitat?.comfort, 0),
    livingSpace: magnitudeOr(t?.habitat?.livingSpace, 0),
    // Climatization is deliberately NOT here: it's a per-kerbal survival rule
    // (rides kerbalism.crew → CrewManifest death-clock meters), not a
    // vessel-level habitat value, so this vessel widget doesn't surface it.
    processes: (t?.processes ?? []).map(toProcessRow),
    // Absent on a vessel with no greenhouse part (the common case), the
    // slot's own component renders nothing for an empty list.
    greenhouses: (t?.greenhouses ?? []).map(toGreenhouseRow),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** amount / |rate| in seconds while draining; null while flat or charging. */
function timeToEmptySec(c: Consumable): number | null {
  if (c.rate >= 0) return null;
  return c.amount / -c.rate;
}

/**
 * "steady" while a consumable is flat or refilling; otherwise a countdown.
 *
 * A string rather than a `<Unit>` because it is built into a meter's
 * `aria-valuetext`, which is an attribute and takes no node. `speakQuantity`
 * is the sanctioned route for that; the readout beside it renders normally.
 */
function formatTimeToEmpty(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "steady";
  return speakQuantity(value("s", Math.max(0, sec)));
}

/** Compact amount formatter: whole numbers drop decimals, small values keep 2. */
function fmtAmt(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function consumableFraction(c: Consumable): number {
  // Clamp to [0,1], a transient amount>capacity (e.g. a tank overfill tick)
  // would otherwise push the meter's aria-valuenow past 100.
  return c.capacity > 0 ? Math.min(1, c.amount / c.capacity) : 0;
}

// `Tone` maps 1:1 onto ui-kit `Value`'s tone vocabulary; the toned Section
// readouts render through `<Value tone={...}>`, so this widget no longer keeps
// its own colour map (the old local TONE_HEX used -bg tokens for text; Value's
// tones use the correct -fg tokens). The `Meter`/`Badge` tone props take the
// same names directly.
type Tone = "go" | "info" | "warn" | "nogo";

/** Higher fraction is better (consumable level, comfort). */
function levelTone(frac: number): Tone {
  if (frac >= 0.5) return "go";
  if (frac >= 0.2) return "warn";
  return "nogo";
}

/** Higher value is worse (e.g. CO2 poisoning). */
function riskTone(frac: number): Tone {
  if (frac >= 0.5) return "nogo";
  if (frac >= 0.2) return "warn";
  return "go";
}

function processTone(state: ProcessRunState): Tone {
  if (state === "broken") return "nogo";
  if (state === "running") return "go";
  return "info";
}

function meterLabel(c: Consumable): string {
  const tte = timeToEmptySec(c);
  return `${fmtAmt(c.amount)} / ${fmtAmt(c.capacity)} · ${formatTimeToEmpty(tte)}`;
}

function overallStatus(d: LifeSupportData): { label: string; tone: Tone } {
  const consumableTones = [d.food, d.water, d.oxygen, d.ec].map((c) =>
    levelTone(consumableFraction(c)),
  );
  // A single fault is a warning (redundancy usually covers it); a second
  // concurrent fault is what actually threatens the vessel.
  const brokenCount = d.processes.filter((p) => p.state === "broken").length;
  const processTone: Tone =
    brokenCount >= 2 ? "nogo" : brokenCount === 1 ? "warn" : "go";
  const tones: Tone[] = [
    ...consumableTones,
    riskTone(d.co2Poisoning),
    processTone,
  ];
  if (tones.includes("nogo")) return { label: "Critical", tone: "nogo" };
  if (tones.includes("warn")) return { label: "Degraded", tone: "warn" };
  return { label: "Nominal", tone: "go" };
}

function shortestEta(d: LifeSupportData): string {
  const ttes = [d.food, d.water, d.oxygen]
    .map(timeToEmptySec)
    .filter((v): v is number => v != null);
  if (ttes.length === 0) return "steady";
  return formatTimeToEmpty(Math.min(...ttes));
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function LifeSupportSystemsComponent({
  w,
  h,
}: Readonly<ComponentProps<LifeSupportConfig>>) {
  const d = useLifeSupport();
  const status = overallStatus(d);
  const cols = w ?? 8;
  const rows = h ?? 13;
  // Below either threshold, compact sheds the habitat detail grid and the
  // process grid down to a one-line summary, the consumable ledger and
  // power meter (the life-critical numbers) always stay.
  const compact = cols < 7 || rows < 9;
  // At very short heights (e.g. a wide-but-shallow landscape placement)
  // even compact's reduced stack, 3 consumable meters + the Habitat
  // summary line + the footer Power meter, doesn't fit the box: Panel's
  // overflow:hidden then clips the Habitat line mid-glyph and pushes the
  // "life-critical" Power meter (see comment above) out of view entirely.
  // Shedding the Habitat summary line too preserves that invariant instead
  // of silently breaking it.
  const ultraCompact = rows < 6;
  // Landscape (wide + short, e.g. landscape-18x5) is exactly the shape that
  // used to break the "Power always stays visible" invariant: there is width
  // to spare but not enough height for a vertical meter stack plus a
  // separate footer meter, so the footer meter sat past Panel's
  // overflow:hidden edge with zero visible bar. Flow Food/Water/Oxygen/Power
  // into one row instead of stacking them; the row uses the width the size
  // bucket alone can't see (getWidgetShape doc comment) and needs a fraction
  // of the vertical space a 4-row stack does, so Power is never a separate,
  // separately-clippable element at this shape.
  const { shape } = getWidgetShape(w, h);
  const landscapeFlow = shape === "landscape";

  const runningCount = d.processes.filter((p) => p.state === "running").length;
  const brokenCount = d.processes.filter((p) => p.state === "broken").length;
  const processSummary =
    brokenCount > 0
      ? `${runningCount} running · ${brokenCount} broken`
      : `${runningCount} / ${d.processes.length} running`;

  return (
    <Panel
      panelTitle="Life Support"
      panelAside={
        <Badge
          role="status"
          aria-live="polite"
          tone={
            status.tone === "go"
              ? "go"
              : status.tone === "nogo"
                ? "nogo"
                : "warn"
          }
        >
          {status.label}
        </Badge>
      }
    >
      {/* Body absorbs any vertical shortfall itself (flex:1 + min-height:0 +
          its own overflow:hidden, the same PanelBody convention documented
          in Panel.tsx) instead of letting the whole Panel overflow and clip
          whatever happens to be last in source order. That guarantees
          FooterRow below, and the Power meter inside it, always get their
          full natural height: at worst Body's own least-critical trailing
          content (e.g. the last few px of a habitat/process row) is what
          gives, never the life-critical Power reading. */}
      <div style={BODY}>
        <Section style={STAT_SECTION}>
          <div style={SECTION_HEAD}>
            <span style={SECTION_LABEL}>Consumables</span>
            <Value tone="info" size="xs" style={SECTION_VALUE}>
              Shortest ETA {shortestEta(d)}
            </Value>
          </div>
          {landscapeFlow ? (
            <div style={METER_ROW}>
              <Meter
                label="Food"
                value={consumableFraction(d.food)}
                tone={levelTone(consumableFraction(d.food))}
                valueLabel={meterLabel(d.food)}
                size="sm"
              />
              <Meter
                label="Water"
                value={consumableFraction(d.water)}
                tone={levelTone(consumableFraction(d.water))}
                valueLabel={meterLabel(d.water)}
                size="sm"
              />
              <Meter
                label="Oxygen"
                value={consumableFraction(d.oxygen)}
                tone={levelTone(consumableFraction(d.oxygen))}
                valueLabel={meterLabel(d.oxygen)}
                size="sm"
              />
              <Meter
                label="Power"
                value={consumableFraction(d.ec)}
                tone={levelTone(consumableFraction(d.ec))}
                valueLabel={meterLabel(d.ec)}
                size="sm"
              />
            </div>
          ) : (
            <div style={METER_STACK_TIGHT}>
              <Meter
                label="Food"
                value={consumableFraction(d.food)}
                tone={levelTone(consumableFraction(d.food))}
                valueLabel={meterLabel(d.food)}
                size={compact ? "sm" : "md"}
              />
              <Meter
                label="Water"
                value={consumableFraction(d.water)}
                tone={levelTone(consumableFraction(d.water))}
                valueLabel={meterLabel(d.water)}
                size={compact ? "sm" : "md"}
              />
              <Meter
                label="Oxygen"
                value={consumableFraction(d.oxygen)}
                tone={levelTone(consumableFraction(d.oxygen))}
                valueLabel={meterLabel(d.oxygen)}
                size={compact ? "sm" : "md"}
              />
            </div>
          )}
        </Section>

        {!ultraCompact && (
          <Section style={STAT_SECTION}>
            <div style={SECTION_HEAD}>
              <span style={SECTION_LABEL}>Habitat</span>
              <Value
                tone={d.pressurized ? "go" : "warn"}
                size="xs"
                style={SECTION_VALUE}
              >
                {d.pressurized ? "Pressurized" : "Unpressurized"}
              </Value>
            </div>
            {!compact && (
              <div style={HABITAT_GRID}>
                <Meter
                  label="Comfort"
                  value={d.comfort}
                  tone={levelTone(d.comfort)}
                  size="sm"
                />
                <Meter
                  label="Living space"
                  value={d.livingSpace}
                  tone="info"
                  size="sm"
                />
                <Meter
                  label="CO2 poisoning"
                  value={d.co2Poisoning}
                  tone={riskTone(d.co2Poisoning)}
                  size="sm"
                />
              </div>
            )}
          </Section>
        )}

        {!compact && (
          <Section style={STAT_SECTION}>
            <div style={SECTION_HEAD}>
              <span style={SECTION_LABEL}>Processes</span>
              <Value
                tone={brokenCount > 0 ? "nogo" : "go"}
                size="xs"
                style={SECTION_VALUE}
              >
                {processSummary}
              </Value>
            </div>
            <div style={PROCESS_GRID}>
              {d.processes.map((p) => (
                <div key={p.id} style={PROCESS_ROW}>
                  <span style={PROCESS_NAME}>{p.name}</span>
                  <Badge tone={processTone(p.state)} size="sm">
                    {p.state}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Augment sections, e.g. the built-in Greenhouse readout, compose
            here, below the process grid. A bare fragment (no extra margin)
            until something is registered into the slot, matching
            PowerSystems' `power-systems.sections` usage. */}
        {!compact && (
          <AugmentSlot
            name="life-support.sections"
            props={{ greenhouses: d.greenhouses }}
          />
        )}
      </div>

      {/* Landscape folds Power into the Consumables row above instead of a
          separate footer, see landscapeFlow's doc comment. */}
      {!landscapeFlow && (
        <div style={FOOTER_ROW}>
          <Meter
            label="Power"
            value={consumableFraction(d.ec)}
            tone={levelTone(consumableFraction(d.ec))}
            valueLabel={meterLabel(d.ec)}
            size={compact ? "sm" : "md"}
          />
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Structural inline styles (CSS-var tokens): a bespoke consumables/habitat/
// process board, no reusable ui-kit primitive fits the layout, so it stays
// local. The kit pieces it reuses (Section, Value, Meter, Badge) take only this
// widget's spacing inline; the toned Section readouts render through `Value`.

// Fills the remaining Panel height and lets ITS OWN bottom edge clip first (see
// the render-site comment on the Body div), so FooterRow's Power meter never
// has to compete with the rest of the widget for the last few px of a short
// box.
const BODY: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

// gap:2px IS the kit's Section. Only the spacing above it and the no-shrink (it
// sits in a scrolling column) are local.
const STAT_SECTION: CSSProperties = {
  marginTop: "var(--space-8)",
  flexShrink: 0,
};

const SECTION_HEAD: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "var(--space-8)",
};

const SECTION_LABEL: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

// Extra layout for the toned Section readout: `Value` supplies tone (-fg),
// tabular-nums and size=xs; the right-align + truncation are this widget's.
const SECTION_VALUE: CSSProperties = {
  textAlign: "right",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// "Tight" is historical: the gap was 5px and snapped up to the --space-6 rung,
// which is also MeterRow's row gap below, so the name no longer asserts a
// difference from it. There is no non-tight MeterStack to contrast with, and
// d60b924e already had the body absorb the shortfall.
const METER_STACK_TIGHT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
  marginTop: "var(--space-2)",
};

// Landscape's side-by-side reflow for Food/Water/Oxygen/Power: always exactly 4
// equal tracks (rather than an auto-fit count that could shrink each track down
// toward its minmax floor and squeeze the label into an ellipsis) so each meter
// gets a full quarter of the available width, the width landscape has to spare
// in the first place.
const METER_ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "var(--space-6) var(--space-16)",
  marginTop: "var(--space-2)",
};

const HABITAT_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "var(--space-6) var(--space-12)",
  marginTop: "var(--space-2)",
};

const PROCESS_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "var(--space-4)",
  marginTop: "var(--space-2)",
};

const PROCESS_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-6)",
  minWidth: 0,
};

const PROCESS_NAME: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const FOOTER_ROW: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
  marginTop: "auto",
  paddingTop: "var(--space-6)",
  flexShrink: 0,
};

registerComponent<LifeSupportConfig>({
  id: "life-support",
  name: "Life Support",
  description:
    "Vessel-centric Kerbalism life support board: the Food/Water/Oxygen consumable ledger with drain rate and time-to-empty, habitat pressure/comfort/CO2/climatization, the scrubber/recycler/processor process states, and the power meter.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 13 },
  minSize: { w: 3, h: 4 },
  component: LifeSupportSystemsComponent,
  channels: ["kerbalism.lifesupport"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  // `life-support.sections`, a body section slot, below the process grid.
  // The built-in Greenhouse readout (`./GreenhouseSection`) fills it out of
  // the box; a future non-Kerbalism life-support source can leave it empty
  // with no change here.
  augmentSlots: ["life-support.sections"],
});

export { LifeSupportSystemsComponent };
