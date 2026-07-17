import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import {
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { formatDuration } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

type CommSignalConfig = Record<string, never>;

// ── Augment slots (Uplink architecture) ─────────────────────────────────────
//
// CommSignal exposes two slots so a comms Uplink can extend the readout WITHOUT
// this widget ever importing backend-aware code (locked map: comm-signal):
//
//  - `comm-signal.sections` (body, below the signal-bars readout) — the primary
//    HIGH-value seat. A RealAntennas Uplink elected via capability contributes a
//    per-antenna breakdown table (which antenna carries the link, its SNR) here,
//    reading only its OWN RA Topics. CommSignal stays RA-agnostic.
//  - `comm-signal.badges` (header, next to the title) — the broad escape hatch
//    for small at-a-glance chips a comms Uplink wants beside the COMMNET title.
//
// Neither slot passes parent coordinates/projection (they aren't overlay slots),
// so the props contract is empty — augments render from their own Topics. The
// declaration-merge below keeps the slot ids co-located here rather
// than in a shared central registry, so parallel widget work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "comm-signal.sections": Record<string, never>;
    "comm-signal.badges": Record<string, never>;
  }
}

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

function CommSignalComponent({
  w,
  h,
}: Readonly<ComponentProps<CommSignalConfig>>) {
  // Every read has a clean stream home now:
  //  - `comm.connected`     -> `comms.link.connected` (the freeze-EXEMPT link
  //    channel — vessel.comms freezes at last-known through a blackout, so the
  //    disconnect edge only fires off comms.link; see map-topic.ts)
  //  - `comm.signalStrength`-> `vessel.comms.signalStrength`
  //  - `comm.controlState`  -> `vessel.state.commsControlStateOrdinal` (the
  //    SDK-derived collapse of `vessel.comms.controlState`'s rich `ControlState`
  //    enum onto this widget's 0/1/2 level scheme — see `vessel-state.ts`)
  //  - `comm.controlStateName` -> `vessel.state.commsControlStateName` (that
  //    same ordinal resolved to its enum NAME string)
  //  - `comm.signalDelay`   -> `comms.delay.oneWaySeconds` (gonogo's own
  //    SignalDelay authority, live via CommsCoreUplink)
  const connected = useTelemetry("comms.link")?.connected;
  const strength = useTelemetry("vessel.comms")?.signalStrength;
  const vesselState = useStream<VesselState>("vessel.state");
  // Collapse the derived channel's `null` (comms unknown this tick) to
  // `undefined` so the empty-state + `describeControl` semantics match the
  // old single-value legacy read exactly.
  const controlState = vesselState?.commsControlStateOrdinal ?? undefined;
  const controlStateName = vesselState?.commsControlStateName ?? undefined;
  const delay = useTelemetry("comms.delay")?.oneWaySeconds;
  const streamStatus = useDataStreamStatus("data", "comm.connected");

  const hasData =
    connected !== undefined ||
    strength !== undefined ||
    controlState !== undefined;

  if (!hasData) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>COMMNET</PanelTitle>
          <AugmentSlot name="comm-signal.badges" props={{}} />
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
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
  // Wide-short: put the bars/headline cluster and the detail grid side-by-side
  // so the width is used instead of clustering top-left.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
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
      <TitleRow>
        <PanelTitle>COMMNET</PanelTitle>
        <AugmentSlot name="comm-signal.badges" props={{}} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && (
        <PanelSubtitle>
          {connected === false ? "No signal" : "Signal to KSC"}
        </PanelSubtitle>
      )}

      <LiveStatus role="status" aria-live="polite">
        {liveAnnouncement}
      </LiveStatus>

      <Body $row={isLandscape}>
        <Readout>
          <Bars role="img" aria-label={`Signal ${bars} of 4`}>
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
            <GridValue>
              {/* null (no measurable ControlPath) reads the same as
                  undefined (nothing arrived yet) — comms-delay-nullable-
                  when-no-path fix: neither is a number to format. */}
              {typeof delay === "number"
                ? formatDuration(delay, { ms: true })
                : "—"}
            </GridValue>
          </Grid>
        )}
      </Body>

      {/* Body sections below the signal-bars readout — a comms Uplink (e.g. a
          RealAntennas per-antenna breakdown) composes here from its own Topics.
          Renders nothing until an augment binds this slot. */}
      <AugmentSlot name="comm-signal.sections" props={{}} />
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "lost";
// Bright fills for the signal bars (non-text UI — full-brightness chips).
const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

// Foreground text variants for the same tones, legible on the dark panel.
// Warning uses the muted cream (`-fg` is near-black, meant for the orange
// chip, not standalone text); nogo's `-fg` is already a light pink.
const TONE_TEXT_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-fg)",
};

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

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

const Body = styled.div<{ $row?: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: ${(p) => (p.$row ? "row" : "column")};
  gap: ${(p) => (p.$row ? "24px" : "8px")};
  min-height: 0;
  align-content: center;
  /* Wide-short: bars/headline cluster left, detail grid right. */
  ${(p) =>
    p.$row &&
    `align-items: center;
     & > * { flex: 1 1 0; min-width: 0; }`}
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
  color: ${({ $tone }) => ($tone ? TONE_TEXT_COLOR[$tone] : "var(--color-text-primary)")};
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
  // Two seats for a comms Uplink to extend the readout without CommSignal ever
  // importing backend-aware code (locked map: comm-signal). See the
  // `SlotRegistry` declaration-merge above for the slot props contracts.
  augmentSlots: ["comm-signal.sections", "comm-signal.badges"],
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
