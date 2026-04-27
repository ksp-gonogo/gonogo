import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
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

function CommSignalComponent(_: Readonly<ComponentProps<CommSignalConfig>>) {
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
        <Empty>No signal data</Empty>
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

  // Aria-live on the wrapper so a loss-of-signal transition gets announced
  // once; loud role=alert is owned by the separate SignalLossBanner primitive
  // at the page level — we don't duplicate it here.
  return (
    <Panel>
      <PanelTitle>COMMNET</PanelTitle>
      <PanelSubtitle>
        {connected === false ? "No signal" : "Signal to KSC"}
      </PanelSubtitle>

      <Readout role="status" aria-live="polite">
        <Bars aria-label={`Signal ${bars} of 4`}>
          {[1, 2, 3, 4].map((i) => (
            <Bar key={i} $lit={i <= bars} $tone={control.tone} />
          ))}
        </Bars>
        <StrengthPct>
          {connected === false
            ? "—"
            : pct !== null
              ? `${(pct * 100).toFixed(0)}%`
              : control.label}
        </StrengthPct>
      </Readout>

      <Grid>
        <GridLabel>Control</GridLabel>
        <GridValue $tone={control.tone}>{control.label}</GridValue>
        <GridLabel>Delay</GridLabel>
        <GridValue>{formatDelay(delay)}</GridValue>
      </Grid>
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "lost";
const TONE_COLOR: Record<Tone, string> = {
  ok: "#00cc66",
  warn: "#ffb347",
  lost: "#ff5252",
};

const Empty = styled.div`
  color: #555;
  font-size: 11px;
  padding: 8px 0;
`;

const Readout = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
`;

const Bars = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 24px;
`;

const Bar = styled.span<{ $lit: boolean; $tone: Tone }>`
  width: 6px;
  background: ${({ $lit, $tone }) => ($lit ? TONE_COLOR[$tone] : "#222")};
  border: 1px solid ${({ $lit, $tone }) => ($lit ? TONE_COLOR[$tone] : "#2a2a2a")};
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

const StrengthPct = styled.span`
  font-family: monospace;
  font-size: 15px;
  color: #ccc;
  letter-spacing: 0.04em;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin-top: 8px;
  align-items: baseline;
`;

const GridLabel = styled.span`
  font-size: 10px;
  color: #666;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const GridValue = styled.span<{ $tone?: Tone }>`
  font-family: monospace;
  font-size: 12px;
  color: ${({ $tone }) => ($tone ? TONE_COLOR[$tone] : "#ccc")};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Signal bars, percentage, probe control state (full / partial / none), and signal delay from KSP's CommNet.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 5 },
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
});

export { CommSignalComponent };
