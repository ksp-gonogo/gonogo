import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Countdown,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Panel,
  Stack,
  Text,
  Unit,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

type CommSignalConfig = Record<string, never>;

// ── Augment slots (Uplink architecture) ─────────────────────────────────────
//
// CommSignal exposes two slots so a comms Uplink can extend the readout WITHOUT
// this widget ever importing backend-aware code (locked map: comm-signal):
//
//  - `comm-signal.sections` (body, below the signal-bars readout): the primary
//    HIGH-value seat. A RealAntennas Uplink elected via capability contributes a
//    per-antenna breakdown table (which antenna carries the link, its SNR) here,
//    reading only its OWN RA Topics. CommSignal stays RA-agnostic.
//  - `comm-signal.badges` (header, next to the title): the broad escape hatch
//    for small at-a-glance chips a comms Uplink wants beside the COMMNET title.
//
// Neither slot passes parent coordinates/projection (they aren't overlay slots),
// so the props contract is empty, augments render from their own Topics. The
// declaration-merge below keeps the slot ids co-located here rather
// than in a shared central registry, so parallel widget work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "comm-signal.sections": Record<string, never>;
    "comm-signal.badges": Record<string, never>;
  }
}

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * What to call the control state, and how to paint it.
 *
 * The TONE comes off the ordinal, never off the name. `CONTROL_STATE_LEVEL`
 * (vessel-state.ts) has already collapsed all twelve `ControlState` enum
 * members onto this 0/1/2 level scheme by the time the widget reads them, and
 * that collapse is the verdict. This used to substring-match the English enum
 * name instead, which read `ProbeNone` and `KerbalNone` as healthy links,
 * because neither is the literal string "None". A vessel with no control
 * painted green in both the Control row and the signal bars. The name is a
 * display label and nothing else.
 *
 * `undefined` is not a link failure: `Unknown` (11) carries no level by design,
 * and neither does a channel that has yet to arrive. Painting either `lost`
 * would assert a failure the wire never reported.
 */
function describeControl(
  name: string | undefined,
  state: number | undefined,
): {
  label: string;
  tone: Tone;
} {
  const label =
    name && name.length > 0
      ? name
      : state === 2
        ? "Full"
        : state === 1
          ? "Partial"
          : state === 0
            ? "None"
            : NULL_DISPLAY;
  const tone: Tone =
    state === 0
      ? "lost"
      : state === 1
        ? "warn"
        : state === 2
          ? "ok"
          : "neutral";
  return { label, tone };
}

function CommSignalComponent({
  w,
  h,
}: Readonly<ComponentProps<CommSignalConfig>>) {
  // Every read has a clean stream home now:
  //  - `comm.connected`     -> `comms.link.connected` (the freeze-EXEMPT link
  //    channel: vessel.comms freezes at last-known through a blackout, so the
  //    disconnect edge only fires off comms.link; see map-topic.ts)
  //  - `comm.signalStrength`-> `vessel.comms.signalStrength`
  //  - `comm.controlState`  -> `vessel.state.commsControlStateOrdinal` (the
  //    SDK-derived collapse of `vessel.comms.controlState`'s rich `ControlState`
  //    enum onto this widget's 0/1/2 level scheme; see `vessel-state.ts`)
  //  - `comm.controlStateName` -> `vessel.state.commsControlStateName` (that
  //    same ordinal resolved to its enum NAME string)
  //  - `comm.signalDelay`   -> `comms.delay.oneWaySeconds` (gonogo's own
  //    SignalDelay authority, live via CommsCoreUplink)
  /**
   * A link indicator is the one instrument where withholding is not merely honest
   * but informative: silence IS evidence about a link. A held "connected: true"
   * from before the gap is the single most misleading thing this widget could
   * draw, because the operator uses it to decide whether the vessel is hearing
   * them at all.
   */
  const linkReading = useTelemetry("comms.link");
  const commsReading = useTelemetry("vessel.comms");
  const connected = judgeable(linkReading)?.connected;
  const strength = judgeable(commsReading)?.signalStrength;
  const linkNotCurrent = notCurrent(linkReading) || notCurrent(commsReading);
  const vesselState = useStream<VesselState>("vessel.state");
  // Collapse the derived channel's `null` (comms unknown this tick) to
  // `undefined` so the empty-state + `describeControl` semantics match the
  // old single-value legacy read exactly.
  const controlState = vesselState?.commsControlStateOrdinal ?? undefined;
  const controlStateName = vesselState?.commsControlStateName ?? undefined;
  const delay = judgeable(useTelemetry("comms.delay"))?.oneWaySeconds;

  const hasData =
    connected !== undefined ||
    strength !== undefined ||
    controlState !== undefined;

  if (!hasData) {
    return (
      <Panel
        panelTitle="COMMNET"
        panelAside={<AugmentSlot name="comm-signal.badges" props={{}} />}
      >
        <EmptyState>
          {linkNotCurrent ? "Link state no longer current" : "No signal data"}
        </EmptyState>
      </Panel>
    );
  }

  // KSP returns signal strength ∈ [0, 1]. Map to 4 discrete bars; this is
  // familiar, readable at a glance, and robust to telemetry jitter at the
  // edges of a connection.
  //
  // Some KSP installs don't publish comm.signalStrength at all (mod load
  // order, RemoteTech overrides, vanilla CommNet variants): in that case
  // we derive bars from comm.controlState so the widget still shows
  // something useful: Full → 4, Partial → 2, None → 0.
  // `.magnitude`: strength is a declared ratio and arrives wrapped. The bar
  // count and the headline percentage are both arithmetic on it, and the old
  // `typeof === "number"` test silently answered "no strength reading" for
  // every live link.
  const raw = strength?.magnitude;
  const strengthValid =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  const pct = strengthValid ? Math.max(0, Math.min(1, raw)) : null;
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

  // Selective rendering: bars + headline value always show; subtitle and
  // detail grid drop as height shrinks.
  const cols = w ?? 6;
  const rows = h ?? 5;
  // Wide-short: put the bars/headline cluster and the detail grid side-by-side
  // so the width is used instead of clustering top-left.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 4;
  const showDetailGrid = rows >= 4 && cols >= 4;
  // "LOS" (loss of signal) vs NULL_DISPLAY (no telemetry), both render zero
  // bars, so the headline label is the only differentiator at tiny
  // sizes where subtitle + detail grid are suppressed. Without this
  // split, an occluded vessel and a connection-lost probe looked
  // identical in the min-3x3 mode.
  const headline =
    connected === false ? (
      "LOS"
    ) : pct !== null ? (
      <Unit value={value("%", pct * 100)} decimals={0} />
    ) : (
      control.label
    );

  // A11y: the visible readout updates on every telemetry tick (percentage,
  // bar count), so it must NOT be a live region, that would flood the screen
  // reader (see CLAUDE.md: "Don't live-region streaming telemetry"). Instead a
  // dedicated visually-hidden status node announces only the connection-state
  // transition: its text changes between "Signal connected" / "Signal lost",
  // which fires at most once per LOS/regain. The loud role=alert is owned by
  // the separate SignalLossBanner primitive at the page level, we don't
  // duplicate it here.
  const liveAnnouncement =
    connected === false
      ? "Signal lost"
      : connected === true
        ? "Signal connected"
        : "";
  return (
    <Panel
      panelTitle="COMMNET"
      panelAside={<AugmentSlot name="comm-signal.badges" props={{}} />}
    >
      <VisuallyHidden role="status" aria-live="polite">
        {liveAnnouncement}
      </VisuallyHidden>

      {/* Link caption relocated out of the panel subtitle into the body
          (staging change), carried by a plain span so the title stands alone. */}
      {showSubtitle && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color:
              connected === false
                ? "var(--color-status-nogo-fg)"
                : "var(--color-text-dim)",
            letterSpacing: "0.04em",
          }}
        >
          {connected === false ? "No signal" : "Signal to KSC"}
        </span>
      )}

      {/* Landscape (wide-short): bars/headline cluster and detail grid sit
          side by side, each taking half the row, rather than clustering
          top-left. Portrait: the same two blocks stack vertically. Neither
          Cluster nor Stack has an even-split "each child grows" mode, so the
          two children get that via a direct style override in landscape. */}
      {isLandscape ? (
        <Cluster
          justify="between"
          align="center"
          style={{ flex: 1, minHeight: 0, gap: "var(--space-24)" }}
        >
          <Cluster justify="start" wrap style={{ flex: "1 1 0", minWidth: 0 }}>
            <SignalBars bars={bars} tone={control.tone} />
            <SignalHeadline headline={headline} lost={connected === false} />
          </Cluster>

          {showDetailGrid && (
            <Grid
              cols="auto 1fr"
              gap="md"
              rowGap="xs"
              align="baseline"
              style={{ flex: "1 1 0", minWidth: 0 }}
            >
              <CommSignalDetailRows control={control} delay={delay} />
            </Grid>
          )}
        </Cluster>
      ) : (
        <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
          <Cluster justify="start" wrap>
            <SignalBars bars={bars} tone={control.tone} />
            <SignalHeadline headline={headline} lost={connected === false} />
          </Cluster>

          {showDetailGrid && (
            <Grid cols="auto 1fr" gap="md" rowGap="xs" align="baseline">
              <CommSignalDetailRows control={control} delay={delay} />
            </Grid>
          )}
        </Stack>
      )}

      {/* Body sections below the signal-bars readout, a comms Uplink (e.g. a
          RealAntennas per-antenna breakdown) composes here from its own Topics.
          Renders nothing until an augment binds this slot. */}
      <AugmentSlot name="comm-signal.sections" props={{}} />
    </Panel>
  );
}

// ── Signal-bar chart + detail grid rows ──────────────────────────────────────

// `neutral` is the no-verdict tone: the control channel said nothing this tick,
// so the readout says nothing either. It is deliberately not a fourth severity
// between ok and warn, and deliberately not lost.
type Tone = "ok" | "warn" | "lost" | "neutral";
// Bright fills for the signal bars (non-text UI, full-brightness chips).
const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
};

// Foreground text variants for the same tones, legible on the dark panel.
// Warning uses the muted cream (`-fg` is near-black, meant for the orange
// chip, not standalone text); nogo's `-fg` is already a light pink.
const TONE_TEXT_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-fg)",
  neutral: "var(--color-text-primary)",
};

// Staircase heights (short to tall), sat at the bottom of the bar chart.
const BAR_HEIGHT_PCT = [30, 50, 75, 100];

/**
 * The four-bar signal chart. A bespoke little visual (per-bar computed
 * height/colour, not a chrome shape ui-kit hosts), so it composes plain
 * elements with inline styles rather than a primitive: no styled-components
 * import, same pixel values (6px bars, 24px height) the original off-scale
 * styled.div/span pair used.
 */
function SignalBars({ bars, tone }: { bars: number; tone: Tone }) {
  return (
    <div
      role="img"
      aria-label={`Signal ${bars} of 4`}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "var(--space-2)",
        height: 24,
      }}
    >
      {[1, 2, 3, 4].map((i) => {
        const lit = i <= bars;
        const color = lit ? TONE_COLOR[tone] : "var(--color-border-subtle)";
        return (
          <span
            key={i}
            style={{
              width: 6,
              background: color,
              border: `1px solid ${color}`,
              // Off-scale on purpose: optical corner softening at the pixel
              // limit on a 6px-wide bar. --radius-xs (2px) rounds this into
              // a lozenge.
              borderRadius: 1,
              height: `${BAR_HEIGHT_PCT[i - 1]}%`,
            }}
          />
        );
      })}
    </div>
  );
}

/** The headline value beside the bars: percentage, LOS, or the control label. */
function SignalHeadline({
  headline,
  lost,
}: {
  headline: ReactNode;
  lost: boolean;
}) {
  return (
    <Text
      tone="default"
      size="lg"
      style={{
        letterSpacing: "0.04em",
        fontWeight: lost ? 700 : 400,
        color: lost ? "var(--color-status-nogo-fg)" : undefined,
      }}
    >
      {headline}
    </Text>
  );
}

/** Control state / signal delay rows, shared by the landscape and portrait grids. */
function CommSignalDetailRows({
  control,
  delay,
}: {
  control: { label: string; tone: Tone };
  delay: Parameters<typeof Countdown>[0]["value"];
}) {
  const labelStyle = {
    color: "var(--color-text-dim)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  };
  return (
    <>
      <Text tone="muted" size="xs" style={labelStyle}>
        Control
      </Text>
      <Text
        tone="default"
        size="sm"
        style={{ color: TONE_TEXT_COLOR[control.tone] }}
      >
        {control.label}
      </Text>
      <Text tone="muted" size="xs" style={labelStyle}>
        Delay
      </Text>
      <Text tone="default" size="sm">
        {/* null (no measurable ControlPath) reads the same as undefined
            (nothing arrived yet): comms-delay-nullable-when-no-path fix:
            neither is a duration to show. */}
        {delay == null ? NULL_DISPLAY : <Countdown value={delay} precise />}
      </Text>
    </>
  );
}

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
  // Four Topics, not one: connectivity is the freeze-exempt `comms.link`,
  // the observation is the frozen `vessel.comms` struct, the two control-state
  // shapes are derived off `vessel.state`, and the delay is gonogo's own
  // authority. The `comm.` prefix made them look like one source.
  dataRequirements: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "vessel.state.commsControlStateOrdinal",
    "vessel.state.commsControlStateName",
    "comms.delay.oneWaySeconds",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
