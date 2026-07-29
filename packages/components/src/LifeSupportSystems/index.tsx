import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { Badge, Meter, Panel, PanelTitle } from "@ksp-gonogo/ui";
import styled from "styled-components";
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
  amount?: number;
  capacity?: number;
  rate?: number;
}

function consumable(r: WireResource | undefined): Consumable {
  return {
    amount: r?.amount ?? 0,
    capacity: r?.capacity ?? 0,
    rate: r?.rate ?? 0,
  };
}

interface WireProcess {
  resource?: string;
  title?: string;
  capacity?: number;
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
    capacity: p.capacity ?? 0,
  };
}

interface WireGreenhouse {
  cropResource?: string;
  foodRatePerSec?: number;
  natural?: number;
  artificial?: number;
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
    natural: g.natural ?? 0,
    artificial: g.artificial ?? 0,
    active: g.active ?? false,
    issue: g.issue ?? "",
    foodRatePerSec: g.foodRatePerSec ?? 0,
  };
}

function useLifeSupport(): LifeSupportData {
  const t = useTelemetry("kerbalism.lifesupport");
  return {
    food: consumable(t?.food),
    water: consumable(t?.water),
    oxygen: consumable(t?.oxygen),
    ec: consumable(t?.electricCharge),
    pressurized: (t?.habitat?.pressure ?? 0) > 0.5,
    co2Poisoning: t?.habitat?.poisoning ?? 0,
    comfort: t?.habitat?.comfort ?? 0,
    livingSpace: t?.habitat?.livingSpace ?? 0,
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

function formatTimeToEmpty(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "steady";
  const s = Math.max(0, sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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

type Tone = "go" | "info" | "warn" | "nogo";

const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-bg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
};

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
    <Panel>
      <HeaderRow>
        <PanelTitle>Life Support</PanelTitle>
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
      </HeaderRow>

      {/* Body absorbs any vertical shortfall itself (flex:1 + min-height:0 +
          its own overflow:hidden, the same PanelBody convention documented
          in Panel.tsx) instead of letting the whole Panel overflow and clip
          whatever happens to be last in source order. That guarantees
          FooterRow below, and the Power meter inside it, always get their
          full natural height: at worst Body's own least-critical trailing
          content (e.g. the last few px of a habitat/process row) is what
          gives, never the life-critical Power reading. */}
      <Body>
        <Section>
          <SectionHead>
            <SectionLabel>Consumables</SectionLabel>
            <SectionValue $tone="info">
              Shortest ETA {shortestEta(d)}
            </SectionValue>
          </SectionHead>
          {landscapeFlow ? (
            <MeterRow>
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
            </MeterRow>
          ) : (
            <MeterStackTight>
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
            </MeterStackTight>
          )}
        </Section>

        {!ultraCompact && (
          <Section>
            <SectionHead>
              <SectionLabel>Habitat</SectionLabel>
              <SectionValue $tone={d.pressurized ? "go" : "warn"}>
                {d.pressurized ? "Pressurized" : "Unpressurized"}
              </SectionValue>
            </SectionHead>
            {!compact && (
              <HabitatGrid>
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
              </HabitatGrid>
            )}
          </Section>
        )}

        {!compact && (
          <Section>
            <SectionHead>
              <SectionLabel>Processes</SectionLabel>
              <SectionValue $tone={brokenCount > 0 ? "nogo" : "go"}>
                {processSummary}
              </SectionValue>
            </SectionHead>
            <ProcessGrid>
              {d.processes.map((p) => (
                <ProcessRowEl key={p.id}>
                  <ProcessName>{p.name}</ProcessName>
                  <Badge tone={processTone(p.state)} size="sm">
                    {p.state}
                  </Badge>
                </ProcessRowEl>
              ))}
            </ProcessGrid>
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
      </Body>

      {/* Landscape folds Power into the Consumables row above instead of a
          separate footer, see landscapeFlow's doc comment. */}
      {!landscapeFlow && (
        <FooterRow>
          <Meter
            label="Power"
            value={consumableFraction(d.ec)}
            tone={levelTone(consumableFraction(d.ec))}
            valueLabel={meterLabel(d.ec)}
            size={compact ? "sm" : "md"}
          />
        </FooterRow>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

// Fills the remaining Panel height and lets ITS OWN bottom edge clip first
// (see the render-site comment on <Body>), so FooterRow's Power meter never
// has to compete with the rest of the widget for the last few px of a short
// box.
const Body = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
  flex-shrink: 0;
`;

const SectionHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
`;

const SectionLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const SectionValue = styled.span<{ $tone: Tone }>`
  font-size: var(--font-size-xs);
  color: ${({ $tone }) => TONE_HEX[$tone]};
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MeterStackTight = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
`;

// Landscape's side-by-side reflow for Food/Water/Oxygen/Power: always
// exactly 4 equal tracks (rather than an auto-fit count that could shrink
// each track down toward its minmax floor and squeeze the label into an
// ellipsis) so each meter gets a full quarter of the available width, the
// width landscape has to spare in the first place.
const MeterRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 16px;
  margin-top: 2px;
`;

const HabitatGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 12px;
  margin-top: 2px;
`;

const ProcessGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  margin-top: 2px;
`;

const ProcessRowEl = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
`;

const ProcessName = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FooterRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
  flex-shrink: 0;
`;

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
