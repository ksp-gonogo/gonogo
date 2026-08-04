import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { Meter } from "@ksp-gonogo/ui";
import { Badge, Panel, ReadoutCaption, Section } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { magnitudeOr } from "../shared/magnitude";

type SpaceWeatherConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// Reads the real KerbalismUplink `kerbalism.spaceweather` Topic (canonical
// one-arg useTelemetry: streams whenever a provider is mounted). Vessel
// altitude (belt-ring placement) comes from the `vessel.flight` channel.
// The presentation below is a pure function of `SpaceWeatherData`, so the
// offline snapshot harness feeds the same shape (see widgetDomSnapshot's
// kerbalism reshape). This hook is the only data boundary.
// ---------------------------------------------------------------------------

type StormState = "none" | "incoming" | "inprogress";

interface SpaceWeatherData {
  radiationRadPerHour: number;
  stormState: StormState;
  innerBelt: boolean;
  outerBelt: boolean;
  magnetosphere: boolean;
  blackout: boolean;
  shieldingValue: number;
  shieldingCapacity: number;
  altitudeKm: number;
  seed: number;
}

function useSpaceWeather(): SpaceWeatherData {
  const t = useTelemetry("kerbalism.spaceweather");
  const flight = useTelemetry("vessel.flight");

  const stormState: StormState = t?.stormInProgress
    ? "inprogress"
    : t?.stormIncoming
      ? "incoming"
      : "none";
  // FUTURE: storm-ETA countdown. The mod emits storm PRESENCE only
  // (stormIncoming/stormInProgress bools, KerbalismCapture.cs): no onset/clear
  // clock: so the timeline renders the phase WITHOUT a numeric countdown. A
  // real countdown needs a mod-side storm-onset clock (Kerbalism tracks storm
  // timing internally / reflectable) surfaced on the Topic; the UI was designed
  // for it, the data isn't wired. Tracked in local_docs/feature_log/.
  const radiationRadPerHour = magnitudeOr(t?.radiationRadPerSecond, 0) * 3600; // API is rad/s
  const innerBelt = t?.innerBelt ?? false;
  const outerBelt = t?.outerBelt ?? false;
  const magnetosphere = t?.magnetosphere ?? false;

  return {
    radiationRadPerHour,
    stormState,
    innerBelt,
    outerBelt,
    magnetosphere,
    blackout: t?.blackout ?? false,
    shieldingValue: magnitudeOr(t?.shieldingAmount, 0),
    // (stormTimeSec removed: see the FUTURE note above.)
    shieldingCapacity: magnitudeOr(t?.shieldingCapacity, 1),
    altitudeKm: magnitudeOr(flight?.altitudeAsl, 0) / 1000,
    // Deterministic noise seed derived from the weather state itself (stable
    // across renders for snapshots; no Math.random, no clock/provider needed).
    seed:
      Math.round(radiationRadPerHour * 1000) +
      (magnetosphere ? 7 : 0) +
      (innerBelt ? 13 : 0) +
      (outerBelt ? 29 : 0) +
      (stormState === "inprogress" ? 101 : stormState === "incoming" ? 53 : 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so the noise chart is stable for snapshots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rad/h -> 0..1 on a log scale so background (~0.01) is still visible next to storm (~5). */
function doseFraction(radPerHour: number): number {
  const lo = 0.005;
  const hi = 12; // inner belt ~10.4 rad/h pins near the top
  const r = Math.max(lo, Math.min(hi, radPerHour));
  return Math.log(r / lo) / Math.log(hi / lo);
}

type Tone = "go" | "info" | "warn" | "nogo";

function doseTone(radPerHour: number): Tone {
  if (radPerHour >= 3) return "nogo";
  if (radPerHour >= 0.5) return "warn";
  if (radPerHour >= 0.05) return "info";
  return "go";
}

const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-bg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
};

function statusFor(d: SpaceWeatherData): { label: string; tone: Tone } {
  if (d.stormState === "inprogress" || d.radiationRadPerHour >= 3)
    return { label: "Take cover", tone: "nogo" };
  if (d.stormState === "incoming" || d.innerBelt || d.outerBelt)
    return { label: "Exposed", tone: "warn" };
  if (!d.magnetosphere) return { label: "Unshielded", tone: "info" };
  return { label: "Sheltered", tone: "go" };
}

// ---------------------------------------------------------------------------
// Sub-sections (inline SVG: the harness rasterises SVG + a Playwright PNG)
// ---------------------------------------------------------------------------

function StormTimeline({ state }: { state: StormState }) {
  // Phases along a fixed axis: quiet | incoming | in-progress | passed.
  const phases = [
    { key: "quiet", label: "Quiet", tone: "go" as Tone, w: 34 },
    { key: "incoming", label: "Incoming", tone: "warn" as Tone, w: 22 },
    { key: "inprogress", label: "Storm", tone: "nogo" as Tone, w: 22 },
    { key: "passed", label: "Passed", tone: "go" as Tone, w: 22 },
  ];
  // "now" marker position (0..100) by state.
  const nowPct = state === "none" ? 17 : state === "incoming" ? 45 : 67;
  // Phase only: no numeric countdown (the mod emits storm presence, not a
  // clock; see the FUTURE note in useSpaceWeather).
  const headline =
    state === "inprogress"
      ? "Storm in progress"
      : state === "incoming"
        ? "CME inbound"
        : "No storm activity";
  let acc = 0;
  return (
    <StatSection>
      <SectionHead>
        <SectionLabel>Storm forecast</SectionLabel>
        <SectionValue $tone={state === "none" ? "go" : "warn"}>
          {headline}
        </SectionValue>
      </SectionHead>
      <svg
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        width="100%"
        height="16"
        role="img"
        aria-label={headline}
      >
        {phases.map((p) => {
          const x = acc;
          acc += p.w;
          return (
            <rect
              key={p.key}
              x={x}
              y={3}
              width={p.w - 0.6}
              height={8}
              rx={1}
              fill={TONE_HEX[p.tone]}
              opacity={0.9}
            />
          );
        })}
        <line
          x1={nowPct}
          y1={0}
          x2={nowPct}
          y2={14}
          stroke="var(--color-text-primary)"
          strokeWidth={0.8}
        />
        <circle cx={nowPct} cy={1.6} r={1.6} fill="var(--color-text-primary)" />
      </svg>
    </StatSection>
  );
}

function BeltRings({
  inner,
  outer,
  magnetosphere,
  altitudeKm,
}: {
  inner: boolean;
  outer: boolean;
  magnetosphere: boolean;
  altitudeKm: number;
}) {
  // Kerbin R=600km; magnetopause ~7590km altitude. Draw rings scaled into a
  // 100-unit box (radius units): body 12, inner belt 26, outer belt 40, pause 48.
  const cx = 50;
  const cy = 50;
  const rings = [
    {
      r: 48,
      tone: "info" as Tone,
      label: "Magnetopause",
      active: magnetosphere,
    },
    { r: 40, tone: "warn" as Tone, label: "Outer belt", active: outer },
    { r: 26, tone: "nogo" as Tone, label: "Inner belt", active: inner },
  ];
  // Vessel radius in box units. When the vessel is IN a belt, snap the dot onto
  // that belt's ring so the "you are here" dot sits on the lit band (the belt
  // bool is authoritative for membership; the ring radii are fixed visual
  // bands, not an altitude scale). Outside any belt, fall back to the altitude
  // map (0..8000km across body(12)..pause(48)): correct for the low-orbit /
  // between-bands case.
  const vr = inner
    ? 26
    : outer
      ? 40
      : 12 + Math.min(1, Math.max(0, altitudeKm / 8000)) * 36;
  const vesselTone: Tone = inner
    ? "nogo"
    : outer
      ? "warn"
      : magnetosphere
        ? "go"
        : "info";
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Radiation belt position"
    >
      {rings.map((ring) => (
        <circle
          key={ring.label}
          cx={cx}
          cy={cy}
          r={ring.r}
          fill="none"
          stroke={TONE_HEX[ring.tone]}
          strokeWidth={ring.active ? 2.4 : 1}
          opacity={ring.active ? 1 : 0.35}
          strokeDasharray={ring.active ? undefined : "2 2"}
        />
      ))}
      {/* faint belt fill when the vessel is inside one */}
      {outer && !inner && (
        <circle cx={cx} cy={cy} r={40} fill={TONE_HEX.warn} opacity={0.08} />
      )}
      {inner && (
        <circle cx={cx} cy={cy} r={26} fill={TONE_HEX.nogo} opacity={0.1} />
      )}
      {/* body */}
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill="var(--color-accent-fg)"
        opacity={0.85}
      />
      {/* vessel */}
      <circle
        cx={cx + vr}
        cy={cy}
        r={3}
        fill={TONE_HEX[vesselTone]}
        stroke="var(--color-text-primary)"
        strokeWidth={0.6}
      />
    </svg>
  );
}

function SolarWindChart({
  radiation,
  storm,
  seed,
  points = 64,
}: {
  radiation: number;
  storm: boolean;
  seed: number;
  points?: number;
}) {
  const rng = mulberry32(seed || 1);
  // Amplitude from the dose fraction; storms get extra violence.
  const amp = (0.12 + doseFraction(radiation) * 0.8) * (storm ? 1.25 : 1);
  const tone = doseTone(radiation);
  const W = 100;
  const H = 30;
  const mid = H * 0.55;
  const step = W / (points - 1);
  let d = `M 0 ${mid.toFixed(2)}`;
  for (let i = 0; i < points; i++) {
    const x = i * step;
    // layered noise for a solar-wind feel
    const n = (rng() - 0.5) * 2 + (rng() - 0.5);
    const y = Math.max(1, Math.min(H - 1, mid - n * amp * mid));
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Solar-wind and radiation-field flux"
    >
      <path d={area} fill={TONE_HEX[tone]} opacity={0.16} />
      <path d={d} fill="none" stroke={TONE_HEX[tone]} strokeWidth={0.9} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function SpaceWeatherComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceWeatherConfig>>) {
  const d = useSpaceWeather();
  const status = statusFor(d);
  const cols = w ?? 8;
  const rows = h ?? 8;
  // The full board needs both width (rings + dose side by side, dose value on
  // one line) and height (five stacked sections). Below either threshold,
  // compact sheds the solar-wind chart + env tags and shrinks the readout.
  const compact = cols < 7 || rows < 6;

  const doseText = `${d.radiationRadPerHour.toFixed(d.radiationRadPerHour < 1 ? 3 : 2)} rad/h`;
  const shieldFrac =
    d.shieldingCapacity > 0 ? d.shieldingValue / d.shieldingCapacity : 0;

  return (
    <Panel
      panelTitle="Space Weather"
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
      <StormTimeline state={d.stormState} />

      <MidRow $compact={compact}>
        <RingsSlot>
          <BeltRings
            inner={d.innerBelt}
            outer={d.outerBelt}
            magnetosphere={d.magnetosphere}
            altitudeKm={d.altitudeKm}
          />
          {d.blackout && <BlackoutTag>Comms blackout</BlackoutTag>}
        </RingsSlot>
        <DoseSlot>
          <DoseValue $tone={doseTone(d.radiationRadPerHour)} $compact={compact}>
            {doseText}
          </DoseValue>
          <DoseCaption>habitat dose rate</DoseCaption>
        </DoseSlot>
      </MidRow>

      {!compact && (
        <FluxSection>
          <SpacedCaption>Solar-wind flux</SpacedCaption>
          <ChartSlot>
            <SolarWindChart
              radiation={d.radiationRadPerHour}
              storm={d.stormState === "inprogress"}
              seed={d.seed}
            />
          </ChartSlot>
        </FluxSection>
      )}

      <FooterRow>
        <Meter
          label="Shielding"
          value={shieldFrac}
          tone={shieldFrac >= 0.6 ? "go" : shieldFrac >= 0.3 ? "warn" : "nogo"}
          valueLabel={`${d.shieldingValue.toFixed(1)} / ${d.shieldingCapacity.toFixed(1)}`}
          size={compact ? "sm" : "md"}
        />
        {!compact && (
          <EnvRow>
            <EnvTag $on={d.magnetosphere}>Magnetosphere</EnvTag>
            <EnvTag $on={d.outerBelt} $tone="warn">
              Outer belt
            </EnvTag>
            <EnvTag $on={d.innerBelt} $tone="nogo">
              Inner belt
            </EnvTag>
          </EnvRow>
        )}
      </FooterRow>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Same shape as LifeSupportSystems': the kit's Section plus the spacing
// above it, which is the only part that is this widget's business.
const StatSection = styled(Section)`
  margin-top: var(--space-8);
`;

const SectionHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-8);
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

const MidRow = styled.div<{ $compact: boolean }>`
  flex: 0 0 auto;
  height: ${({ $compact }) => ($compact ? "68px" : "86px")};
  display: grid;
  grid-template-columns: ${({ $compact }) =>
    $compact ? "minmax(64px, 36%) 1fr" : "minmax(90px, 42%) 1fr"};
  align-items: stretch;
  gap: var(--space-12);
  margin-top: ${({ $compact }) => ($compact ? "var(--space-4)" : "var(--space-10)")};
  min-height: 0;
  overflow: hidden;
`;

const FluxSection = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-10);
  min-height: 0;
`;

const RingsSlot = styled.div`
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  & > svg {
    max-height: 100%;
    max-width: 100%;
    width: auto;
    height: 100%;
  }
`;

const BlackoutTag = styled.span`
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  /* Text sitting ON the nogo-bg fill, not beside it: -fg (2.61:1 here) fails
     the 4.5:1 AA floor. -on-bg is the token for exactly this case. */
  color: var(--color-status-nogo-on-bg);
  background: var(--color-status-nogo-bg);
  border-radius: var(--radius-sm);
  padding: var(--space-hair) var(--space-6);
  white-space: nowrap;
`;

const DoseSlot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
`;

const DoseValue = styled.div<{ $tone: Tone; $compact: boolean }>`
  /* Both off their scales, as one pair: 19/23px is a prop-driven display
     tier above the 16px top of the type scale, and the 1.05 is tuned to it,
     a body line-height on a readout this size clips descenders. */
  font-size: ${({ $compact }) => ($compact ? "19px" : "23px")};
  font-weight: 700;
  line-height: 1.05;
  color: ${({ $tone }) => TONE_HEX[$tone]};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: 0 0 auto;
`;

const DoseCaption = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

// ReadoutCaption, not FieldLabel: these caption read-only values, and the
// kit's FieldLabel is a <label>, which belongs to a form control. Only the
// spacing above is this widget's; the type treatment is the kit's.
const SpacedCaption = styled(ReadoutCaption)`
  display: block;
  margin-top: var(--space-8);
`;

const ChartSlot = styled.div`
  flex: 0 0 auto;
  height: 44px;
  width: 100%;
`;

const FooterRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: auto;
  padding-top: var(--space-6);
`;

const EnvRow = styled.div`
  display: flex;
  gap: var(--space-6);
  flex-wrap: wrap;
`;

const EnvTag = styled.span<{ $on: boolean; $tone?: Tone }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: var(--space-hair) var(--space-6);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-subtle);
  color: ${({ $on, $tone }) =>
    $on ? TONE_HEX[$tone ?? "go"] : "var(--color-text-muted)"};
  border-color: ${({ $on, $tone }) =>
    $on ? TONE_HEX[$tone ?? "go"] : "var(--color-border-subtle)"};
  opacity: ${({ $on }) => ($on ? 1 : 0.5)};
  white-space: nowrap;
`;

registerComponent<SpaceWeatherConfig>({
  id: "space-weather",
  name: "Space Weather",
  description:
    "Radiation, storm forecast, and magnetic-belt exposure for the active vessel: CME timeline, habitat dose rate with a solar-wind flux trace, belt/magnetopause position rings, and shielding.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 3, h: 4 },
  component: SpaceWeatherComponent,
  channels: ["kerbalism.spaceweather"],
  optionalChannels: ["vessel.flight"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});

export { SpaceWeatherComponent };
