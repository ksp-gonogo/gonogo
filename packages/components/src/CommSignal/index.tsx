import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

type CommSignalConfig = Record<string, never>;

// Telemachus' `comm.controlState` is an enum:
//   0 = none, 1 = partial (unmanned probe with crew nearby etc.), 2 = full
// The name accessor `comm.controlStateName` mirrors the stock KSP string so
// we prefer it when present and fall back to the integer for legacy.
function describeControl(
  name: string | undefined,
  state: number | undefined,
): {
  label: string;
  tone: "ok" | "warn" | "lost";
} {
  const resolved =
    name && name.length > 0
      ? name
      : state === 2
        ? "Full"
        : state === 1
          ? "Partial"
          : state === 0
            ? "None"
            : "—";
  const lower = resolved.toLowerCase();
  if (lower === "none" || lower.includes("no signal"))
    return { label: resolved, tone: "lost" };
  if (lower === "partial" || lower.includes("partial"))
    return { label: resolved, tone: "warn" };
  return { label: resolved, tone: "ok" };
}

function formatDelay(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 0.001) return "0 ms";
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s}s`;
}

function CommSignalComponent({
  w,
  h,
}: Readonly<ComponentProps<CommSignalConfig>>) {
  const connected = useDataValue("data", "comm.connected");
  const strength = useDataValue("data", "comm.signalStrength");
  const controlState = useDataValue("data", "comm.controlState");
  const controlStateName = useDataValue("data", "comm.controlStateName");
  const delay = useDataValue("data", "comm.signalDelay");

  const hasData =
    connected !== undefined ||
    strength !== undefined ||
    controlState !== undefined;

  if (!hasData) {
    return (
      <Panel>
        <PanelTitle>COMMNET</PanelTitle>
        <EmptyState>No signal data</EmptyState>
      </Panel>
    );
  }

  // KSP returns signal strength ∈ [0, 1]. Map to 4 discrete bars; this is
  // familiar, readable at a glance, and robust to telemetry jitter at the
  // edges of a connection.
  //
  // Some KSP installs don't publish comm.signalStrength at all (mod load
  // order, RemoteTech overrides, vanilla CommNet variants) — in that case
  // we derive bars from comm.controlState so the widget still shows
  // something useful: Full → 4, Partial → 2, None → 0.
  const strengthValid =
    typeof strength === "number" && Number.isFinite(strength) && strength > 0;
  const pct = strengthValid ? Math.max(0, Math.min(1, strength)) : null;
  let bars: number;
  if (connected === false) {
    bars = 0;
  } else if (pct !== null) {
    bars = Math.max(1, Math.ceil(pct * 4));
  } else if (controlState === 2) {
    bars = 4;
  } else if (controlState === 1) {
    bars = 2;
  } else if (controlState === 0) {
    bars = 0;
  } else {
    bars = 0;
  }
  const control = describeControl(controlStateName, controlState);

  // Selective rendering — bars + headline value always show; subtitle and
  // detail grid drop as height shrinks.
  const cols = w ?? 6;
  const rows = h ?? 5;
  const showSubtitle = rows >= 4;
  const showDetailGrid = rows >= 4 && cols >= 4;
  // "LOS" (loss of signal) vs "—" (no telemetry) — both render zero
  // bars, so the headline label is the only differentiator at tiny
  // sizes where subtitle + detail grid are suppressed. Without this
  // split, an occluded vessel and a connection-lost probe looked
  // identical in the min-3x3 mode.
  const headline =
    connected === false
      ? "LOS"
      : pct !== null
        ? `${(pct * 100).toFixed(0)}%`
        : control.label;

  // A11y: the visible readout updates on every telemetry tick (percentage,
  // bar count), so it must NOT be a live region — that would flood the screen
  // reader (see CLAUDE.md: "Don't live-region streaming telemetry"). Instead a
  // dedicated visually-hidden status node announces only the connection-state
  // transition: its text changes between "Signal connected" / "Signal lost",
  // which fires at most once per LOS/regain. The loud role=alert is owned by
  // the separate SignalLossBanner primitive at the page level — we don't
  // duplicate it here.
  const liveAnnouncement =
    connected === false
      ? "Signal lost"
      : connected === true
        ? "Signal connected"
        : "";
  return (
    <Panel>
      <PanelTitle>COMMNET</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle>
          {connected === false ? "No signal" : "Signal to KSC"}
        </PanelSubtitle>
      )}

      <LiveStatus role="status" aria-live="polite">
        {liveAnnouncement}
      </LiveStatus>

      <Body>
        <Readout>
          <Bars aria-label={`Signal ${bars} of 4`}>
            {[1, 2, 3, 4].map((i) => (
              <Bar key={i} $lit={i <= bars} $tone={control.tone} />
            ))}
          </Bars>
          <StrengthPct $tone={connected === false ? "lost" : undefined}>
            {headline}
          </StrengthPct>
        </Readout>

        {showDetailGrid && (
          <Grid>
            <GridLabel>Control</GridLabel>
            <GridValue $tone={control.tone}>{control.label}</GridValue>
            <GridLabel>Delay</GridLabel>
            <GridValue>{formatDelay(delay)}</GridValue>
          </Grid>
        )}
      </Body>
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "lost";
const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

// Visually hidden, but read by screen readers. Only its text content changes
// (and only on a connection-state transition), so the polite live region
// announces LOS / signal-restored without floating streaming telemetry.
const LiveStatus = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  align-content: center;
`;

const Readout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`;

const Bars = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 24px;
`;

const Bar = styled.span<{ $lit: boolean; $tone: Tone }>`
  width: 6px;
  background: ${({ $lit, $tone }) => ($lit ? TONE_COLOR[$tone] : "var(--color-border-subtle)")};
  border: 1px solid ${({ $lit, $tone }) => ($lit ? TONE_COLOR[$tone] : "var(--color-border-subtle)")};
  border-radius: 1px;
  /* Staircase — short to tall. Sits at the bottom of the flex container. */
  &:nth-child(1) {
    height: 30%;
  }
  &:nth-child(2) {
    height: 50%;
  }
  &:nth-child(3) {
    height: 75%;
  }
  &:nth-child(4) {
    height: 100%;
  }
`;

const StrengthPct = styled.span<{ $tone?: Tone }>`
  font-size: 15px;
  color: ${({ $tone }) =>
    $tone === "lost"
      ? "var(--color-status-nogo-fg)"
      : "var(--color-text-primary)"};
  letter-spacing: 0.04em;
  font-weight: ${({ $tone }) => ($tone === "lost" ? 700 : 400)};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  align-items: baseline;
`;

const GridLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const GridValue = styled.span<{ $tone?: Tone }>`
  font-size: 12px;
  color: ${({ $tone }) => ($tone ? TONE_COLOR[$tone] : "var(--color-text-primary)")};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Signal bars, percentage, probe control state (full / partial / none), and signal delay from KSP's CommNet.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  component: CommSignalComponent,
  dataRequirements: [
    "comm.connected",
    "comm.signalStrength",
    "comm.controlState",
    "comm.controlStateName",
    "comm.signalDelay",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
