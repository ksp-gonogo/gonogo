import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getWidgetShape,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { type CommsHop, type Value, value } from "@ksp-gonogo/sitrep-sdk";
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
import { Fragment, type ReactNode, useMemo } from "react";
import {
  buildCommsRouteNodes,
  type CommsRouteNode,
  commsBottleneckHopId,
  commsHopId,
  commsLegTimeSeconds,
  commsRouteRelayCount,
} from "./commsRoute";

const topics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "vessel.state", "comms.delay"],
  fields: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "vessel.state.commsControlStateOrdinal",
    "vessel.state.commsControlStateName",
    "comms.delay.oneWaySeconds",
  ],
});

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
//
// The slot passes no parent coordinates/projection (it is not an overlay slot),
// so the props contract is empty and an augment renders from its own Topics. The
// declaration-merge below keeps the slot id co-located here rather
// than in a shared central registry, so parallel widget work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "comm-signal.sections": Record<string, never>;
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
  //  - `comm.commandCentre` -> `comms.commandCentre` (which centre the active
  //    vessel's own ControlPath terminates at this tick: KSC, or a crewed
  //    control-source vessel under the stock six-kerbal rule). Every other read
  //    above is ALREADY relative to that centre, because stock prefers a route
  //    home and falls back to the nearest control source only when no home is
  //    reachable. This is only the LABEL, and it used to be the literal string
  //    "KSC" while the numbers beside it were not.
  //  - `comms.path`         -> the ordered hop list the route schedule draws
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

  /**
   * The centre's NAME falls back to "KSC" when the channel is absent or empty,
   * which is the honest default: KSC is the only centre the game itself ever
   * creates without a mod, or without a crewed vessel meeting the
   * control-source threshold. Every fixture recorded before the channel existed
   * therefore keeps reading exactly as it did.
   */
  const commandCentreName = judgeable(
    useTelemetry("comms.commandCentre"),
  )?.displayName;
  const centreLabel =
    commandCentreName && commandCentreName.length > 0
      ? commandCentreName
      : "KSC";

  const hops = judgeable(useTelemetry("comms.path"))?.hops ?? [];
  const relayCount = commsRouteRelayCount(hops);

  /**
   * Gonogo is the experience FROM the command centre, so the route's source
   * stop is NAMED for the active vessel rather than addressed as "you". Falls
   * back to a generic label on the rare tick `vessel.identity` has not resolved
   * yet (scene load), same shape as the `centreLabel` fallback above.
   */
  const vesselName = judgeable(useTelemetry("vessel.identity"))?.name;
  const vesselLabel =
    vesselName && vesselName.length > 0 ? vesselName : "Vessel";

  // Per-hop bitrate comes from a `comm-signal.hop-rates` contribution, NOT from
  // the core hop: `comms.path` stays provider-agnostic. A comms Uplink reads its
  // OWN per-hop-rate Topic and yields an entry keyed by the same node ids these
  // hops carry, and the schedule joins them by `commsHopId`. No contribution
  // means no bitrate and an otherwise unchanged schedule, which is what bare
  // CommNet gets. CommSignal only ever names the slot id.
  const hopRateEntries = useContributions("comm-signal.hop-rates");
  const rateByHopId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of hopRateEntries) {
      map.set(commsHopId(entry.fromNodeId, entry.toNodeId), entry.bitsPerSec);
    }
    return map;
  }, [hopRateEntries]);

  const hasData =
    connected !== undefined ||
    strength !== undefined ||
    controlState !== undefined;

  if (!hasData) {
    return (
      <Panel panelTitle="COMMNET">
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
  // The vertical train schedule needs more room than the detail grid alone: in
  // landscape it is a whole extra column beside the readout, so it only needs
  // the detail grid's own rows floor; portrait stacks it BELOW the readout and
  // needs real headroom above that, or the schedule is clipped at the
  // registered default (6x5) with nothing to show for it. Below the threshold
  // the caption still names the centre, with a hop-count hint instead of the
  // schedule, so a cramped tile loses the route's detail and never the route.
  const showFullPath = cols >= 5 && (isLandscape ? rows >= 4 : rows >= 6);
  const hopHint =
    connected !== false && hops.length > 0 && !showFullPath
      ? relayCount === 0
        ? " (direct)"
        : ` (${relayCount} relay${relayCount === 1 ? "" : "s"})`
      : "";
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
    <Panel panelTitle="COMMNET">
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
          {connected === false
            ? "No signal"
            : `Signal to ${centreLabel}${hopHint}`}
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

          {showFullPath && (
            <div style={{ flex: "0 1 auto", minWidth: 0 }}>
              <CommsPathRoute
                hops={hops}
                vesselLabel={vesselLabel}
                centreLabel={centreLabel}
                pathDelay={delay}
                rateByHopId={rateByHopId}
              />
            </div>
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

          {showFullPath && (
            <CommsPathRoute
              hops={hops}
              vesselLabel={vesselLabel}
              centreLabel={centreLabel}
              pathDelay={delay}
              rateByHopId={rateByHopId}
            />
          )}
        </Stack>
      )}
    </Panel>
  );
}

// ── Comms-path route: a vertical train-schedule (vessel at top, centre at
//    bottom) ───────────────────────────────────────────────────────────────

const ROUTE_LABEL_STYLE = {
  color: "var(--color-text-dim)",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

// Rail geometry: a dashed vertical line down the left edge with a circle at
// each stop, train-schedule style. The line is a `borderLeft` on every row's
// rail slot (stop rows AND leg rows): adjoining slots share an edge, so the
// dash pattern reads as one continuous rail down the column rather than a
// broken segment per row.
const RAIL_WIDTH_PX = 20;
const RAIL_STOP_DIAMETER_PX = 10;

/**
 * The vertical train-schedule: the source vessel at the top, each relay as a
 * circle on the rail, the command centre at the bottom. Each leg's distance AND
 * light-time (and the per-hop bitrate a `comm-signal.hop-rates` contributor
 * supplies, when present, with the bottleneck hop flagged) sit in the gap
 * between its two stops, against the rail. Renders nothing for an empty `hops`
 * list (no path home is already covered by the LOS headline).
 */
function CommsPathRoute({
  hops,
  vesselLabel,
  centreLabel,
  pathDelay,
  rateByHopId,
}: {
  hops: readonly CommsHop[];
  vesselLabel: string;
  centreLabel: string;
  /** The path's total one-way delay: apportioned across legs by distance, see `commsLegTimeSeconds`. */
  pathDelay: Value<"s"> | undefined;
  /** Per-hop forward bitrate (bits/sec) keyed by `commsHopId`, joined from the
   *  `comm-signal.hop-rates` contribution. Empty under bare CommNet / no RA. */
  rateByHopId: ReadonlyMap<string, number>;
}) {
  const nodes = buildCommsRouteNodes(hops, vesselLabel, centreLabel);
  if (nodes.length === 0) return null;
  const bottleneckId = commsBottleneckHopId(hops, rateByHopId);
  return (
    <Stack gap="xs" style={{ minWidth: 0 }}>
      <Text tone="muted" size="xs" style={ROUTE_LABEL_STYLE}>
        Route
      </Text>
      <div>
        {nodes.map((node, i) => {
          const hop = i < hops.length ? hops[i] : undefined;
          const hopId = hop ? commsHopId(hop.from, hop.to) : undefined;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stops have no stable identity beyond their position along the rail
            <Fragment key={i}>
              <CommsPathStop
                node={node}
                emphasize={i === 0 || i === nodes.length - 1}
              />
              {hop && hopId !== undefined && (
                <CommsPathLeg
                  hop={hop}
                  hops={hops}
                  pathDelay={pathDelay}
                  rate={rateByHopId.get(hopId)}
                  isBottleneck={hopId === bottleneckId}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </Stack>
  );
}

/** One stop on the rail: a circle marker plus the stop's label. */
function CommsPathStop({
  node,
  emphasize,
}: {
  node: CommsRouteNode;
  emphasize: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
      }}
    >
      <RailSlot stop />
      <Text
        tone="default"
        size="sm"
        weight={emphasize ? "semibold" : "regular"}
        title={node.title}
      >
        {node.label}
      </Text>
    </div>
  );
}

/**
 * One leg's distance AND light-time, plus, when a `comm-signal.hop-rates`
 * contribution supplied one, this hop's forward bitrate: the slowest hop in
 * the path (the bottleneck that caps end-to-end throughput) is flagged by
 * tinting its rate amber, since that is the number an operator reads to know
 * the real ceiling. No label word: a leg is a fixed-width row in the
 * schedule, and spelling the flag out as text was overflowing it. Colour
 * alone is never the only signal (WCAG 2.1 AA), so a `VisuallyHidden` hint
 * and a hover `title` carry the same meaning to screen readers and mouse
 * users respectively.
 */
function CommsPathLeg({
  hop,
  hops,
  pathDelay,
  rate,
  isBottleneck,
}: {
  hop: CommsHop;
  hops: readonly CommsHop[];
  pathDelay: Value<"s"> | undefined;
  /** This hop's forward bitrate (bits/sec), or undefined when none was contributed. */
  rate: number | undefined;
  /** Whether this hop is the path's minimum-rate (limiting) hop. */
  isBottleneck: boolean;
}) {
  const legSeconds = commsLegTimeSeconds(hop, hops, pathDelay);
  const hasDetail = hop.distanceMeters !== undefined || rate !== undefined;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        minHeight: hasDetail ? undefined : "var(--space-16)",
      }}
    >
      <RailSlot stop={false} />
      {hasDetail && (
        <Cluster
          gap="xs"
          align="baseline"
          style={{ color: "var(--color-text-dim)" }}
        >
          {hop.distanceMeters !== undefined && (
            <Text tone="muted" size="xs">
              <Unit value={hop.distanceMeters} />
            </Text>
          )}
          {legSeconds !== undefined && (
            // nowrap: `Countdown`'s "0 ms" is plain text with a breaking
            // space, unlike `Unit`'s own number+symbol pairing (which
            // carries its own nowrap), so a narrow column could otherwise
            // split it mid-value across two lines.
            <Text tone="muted" size="xs" style={{ whiteSpace: "nowrap" }}>
              <Countdown value={legSeconds} precise />
            </Text>
          )}
          {/* Per-hop bitrate, joined from the `comm-signal.hop-rates`
              contribution (never a core hop field): absent under bare CommNet /
              no RA, so it simply never renders there. */}
          {rate !== undefined && (
            <Text
              tone="muted"
              size="xs"
              weight={isBottleneck ? "semibold" : "regular"}
              title={
                isBottleneck
                  ? "Slowest hop: caps end-to-end throughput"
                  : undefined
              }
              style={{
                whiteSpace: "nowrap",
                // `TONE_TEXT_COLOR` below explains the choice of the MUTED
                // warning foreground: the bare `-fg` token is near-black,
                // meant for the orange chip rather than standalone text on
                // this panel. `Text`'s own `warn` tone resolves to that bare
                // token, so it cannot serve here.
                color: isBottleneck
                  ? "var(--color-status-warning-fg-muted)"
                  : undefined,
              }}
            >
              <Unit value={value("bit/s", rate)} />
              {isBottleneck && (
                <VisuallyHidden>
                  , slowest hop, limits end-to-end rate
                </VisuallyHidden>
              )}
            </Text>
          )}
        </Cluster>
      )}
    </div>
  );
}

/**
 * One row's slice of the dashed vertical rail: the line itself (a
 * `borderLeft` stretched the row's full height) plus, at a stop row, the
 * circle marker centred on it. Purely decorative, the stop label beside it
 * already carries the same information, so this is hidden from assistive
 * tech rather than duplicated into it.
 */
function RailSlot({ stop }: { stop: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: RAIL_WIDTH_PX,
        alignSelf: "stretch",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: RAIL_WIDTH_PX / 2 - 1,
          top: 0,
          bottom: 0,
          borderLeft: "2px dashed var(--color-border-subtle)",
        }}
      />
      {stop && (
        <div
          style={{
            position: "absolute",
            left: (RAIL_WIDTH_PX - RAIL_STOP_DIAMETER_PX) / 2,
            top: "50%",
            transform: "translateY(-50%)",
            width: RAIL_STOP_DIAMETER_PX,
            height: RAIL_STOP_DIAMETER_PX,
            // border-box: the 2px border must be INCLUDED in the diameter,
            // not added on top of it. Content-box (the default) rendered a
            // 14px circle (10px content + 2px border each side) whose centre
            // sat 2px right of the rail's dashed line, off-centre.
            boxSizing: "border-box",
            borderRadius: "50%",
            background: "var(--color-surface-panel)",
            border: "2px solid var(--color-text-dim)",
          }}
        />
      )}
    </div>
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
  augmentSlots: ["comm-signal.sections"],
  // Four Topics, not one: connectivity is the freeze-exempt `comms.link`,
  // the observation is the frozen `vessel.comms` struct, the two control-state
  // shapes are derived off `vessel.state`, and the delay is gonogo's own
  // authority. The `comm.` prefix made them look like one source.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
