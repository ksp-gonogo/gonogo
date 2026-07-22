import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { Badge, Meter, Panel, PanelTitle } from "@ksp-gonogo/ui";
import styled from "styled-components";

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
  id: string;
  name: string;
  state: ProcessRunState;
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
  climatization: number;
  processes: ProcessRow[];
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

/** Match a live process to a display row by known resource id / title, deriving its run state. */
function processRow(
  id: string,
  name: string,
  processes: {
    resource?: string;
    title?: string;
    running?: boolean;
    broken?: boolean;
  }[],
): ProcessRow {
  const p = processes.find(
    (x) => x.resource === `_${idToResource(id)}` || x.title === name,
  );
  const state: ProcessRunState = p?.broken
    ? "broken"
    : p?.running
      ? "running"
      : "idle";
  return { id, name, state };
}

/** Display id -> Kerbalism process resource stem (fixture `resource` is `_<Stem>`). */
function idToResource(id: string): string {
  switch (id) {
    case "scrubber":
      return "Scrubber";
    case "waterRecycler":
      return "WaterRecycler";
    case "wasteProcessor":
      return "WasteProcessor";
    case "fuelCell":
      return "MonopropFuelCell";
    default:
      return id;
  }
}

function useLifeSupport(): LifeSupportData {
  const t = useTelemetry("kerbalism.lifesupport");
  const processes = t?.processes ?? [];
  return {
    food: consumable(t?.food),
    water: consumable(t?.water),
    oxygen: consumable(t?.oxygen),
    ec: consumable(t?.electricCharge),
    pressurized: (t?.habitat?.pressure ?? 0) > 0.5,
    co2Poisoning: t?.habitat?.poisoning ?? 0,
    comfort: t?.habitat?.comfort ?? 0,
    livingSpace: t?.habitat?.livingSpace ?? 0,
    // Climatization is a per-kerbal rule (rides kerbalism.crew, surfaced in the
    // CrewManifest death-clock meters), not a vessel-level habitat value — the
    // vessel LS ledger shows 0 here.
    climatization: 0,
    processes: [
      processRow("scrubber", "Scrubber", processes),
      processRow("waterRecycler", "Water recycler", processes),
      processRow("wasteProcessor", "Waste processor", processes),
      processRow("fuelCell", "Fuel cell", processes),
    ],
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
  return c.capacity > 0 ? c.amount / c.capacity : 0;
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

/** Higher value is worse (CO2 poisoning, climatization stress). */
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
    riskTone(d.climatization),
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
  // process grid down to a one-line summary — the consumable ledger and
  // power meter (the life-critical numbers) always stay.
  const compact = cols < 7 || rows < 9;

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

      <Section>
        <SectionHead>
          <SectionLabel>Consumables</SectionLabel>
          <SectionValue $tone="info">
            Shortest ETA {shortestEta(d)}
          </SectionValue>
        </SectionHead>
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
      </Section>

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
            <Meter
              label="Climatization"
              value={d.climatization}
              tone={riskTone(d.climatization)}
              size="sm"
            />
          </HabitatGrid>
        )}
      </Section>

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

      <FooterRow>
        <Meter
          label="Power"
          value={consumableFraction(d.ec)}
          tone={levelTone(consumableFraction(d.ec))}
          valueLabel={meterLabel(d.ec)}
          size={compact ? "sm" : "md"}
        />
      </FooterRow>
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
});

export { LifeSupportSystemsComponent };
