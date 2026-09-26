import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  getWidgetShape,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  CONTROL_STATE_NAMES,
  type CommsHop,
  type ControlStateName,
  collapseControlStateLevel,
  enumNameOf,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Countdown,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
  Text,
  Unit,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { Fragment, type ReactNode, useMemo } from "react";
import "./badge";
import {
  buildCommsRouteNodes,
  type CommsRouteNode,
  commsBottleneckHopId,
  commsHopId,
  commsLegTime,
  commsRouteRelayCount,
} from "./commsRoute";

const topics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "comms.delay"],
  fields: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
  ],
});

type CommSignalConfig = Record<string, never>;

// A comms Uplink contributes a per-antenna breakdown below the readout from its own Topics, so this widget stays backend-agnostic.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "comm-signal.sections": Record<string, never>;
  }
}

/**
 * What to call the control state, and how to paint it. The tone comes off the
 * collapsed ordinal, never the name: `ProbeNone` and `KerbalNone` are not the
 * string "None" and would otherwise paint green. An undefined level is not a
 * link failure, so it paints neutral rather than lost.
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
  // A held "connected: true" from before a gap is the most misleading thing this widget could draw: silence is evidence about a link.
  const linkReading = useTelemetry("comms.link");
  const commsReading = useTelemetry("vessel.comms");
  /*
   * Every reading below is a verdict about now, so each is taken from the
   * observation alone. `comms.delay` is reckonable but is read observed-only
   * too, because it is drawn in the same styling as the verdicts.
   */
  const connected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;
  const strength =
    commsReading.state === "observed"
      ? commsReading.value.signalStrength
      : undefined;
  const linkNotCurrent =
    linkReading.state === "stale" || commsReading.state === "stale";
  /*
   * The control state is held through a stale reading because a pill that
   * blanked between frames would read as a control loss; `noSignal` withholds
   * it on screen.
   */
  const commsHeld =
    commsReading.state === "observed" || commsReading.state === "stale"
      ? commsReading.value
      : undefined;
  const controlState =
    commsHeld === undefined
      ? undefined
      : collapseControlStateLevel(commsHeld.controlState);
  const controlStateName = enumNameOf<ControlStateName>(
    CONTROL_STATE_NAMES,
    commsHeld?.controlState,
  );
  const delayReading = useTelemetry("comms.delay");
  const delay =
    delayReading.state === "observed"
      ? delayReading.value.oneWaySeconds
      : undefined;

  // KSC is the only centre the game creates without a mod or a qualifying crewed vessel, so it is the default.
  const centreReading = useTelemetry("comms.commandCentre");
  const commandCentreName =
    centreReading.state === "observed"
      ? centreReading.value.displayName
      : undefined;
  const centreLabel =
    commandCentreName && commandCentreName.length > 0
      ? commandCentreName
      : "KSC";

  const pathReading = useTelemetry("comms.path");
  const hops =
    (pathReading.state === "observed" ? pathReading.value.hops : undefined) ??
    [];
  const relayCount = commsRouteRelayCount(hops);

  const identityReading = useTelemetry("vessel.identity");
  const vesselName =
    identityReading.state === "observed"
      ? identityReading.value.name
      : undefined;
  const vesselLabel =
    vesselName && vesselName.length > 0 ? vesselName : "Vessel";

  // Per-hop bitrate comes from a contribution, never the core hop; bare CommNet has none and the schedule is otherwise unchanged.
  const hopRateEntries = useContributions("comm-signal.hop-rates");
  const rateByHopId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of hopRateEntries) {
      map.set(commsHopId(entry.fromNodeId, entry.toNodeId), entry.bitsPerSec);
    }
    return map;
  }, [hopRateEntries]);

  // When the link state stops arriving, every line nulls and one badge carries the reason.
  const noSignal = linkNotCurrent;
  const nothingHasArrived =
    connected === undefined &&
    strength === undefined &&
    controlState === undefined;

  /*
   * The empty state is for never-arrived only. A panel that has something
   * must not hide it when its verdicts go stale: it renders with null lines
   * and the badge instead.
   */
  if (nothingHasArrived && !noSignal) {
    return (
      <Panel
        panelTitle="COMMNET"
        sections={
          <Section>
            <EmptyState>No signal data</EmptyState>
          </Section>
        }
      />
    );
  }

  // With no strength reading, bars derive from the control state (Full 4, Partial 2, None 0).
  const raw = strength?.magnitude;
  const strengthValid =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  const pct = strengthValid ? Math.max(0, Math.min(1, raw)) : null;
  // `null` when nothing arrived to judge the link by: a count of zero is a verdict.
  let bars: number | null;
  if (noSignal) {
    /*
     * Withheld: `controlState` is read off the held `vessel.comms`, so the
     * bars would otherwise paint a confident "Full" above a caption saying the
     * verdict is not current.
     */
    bars = 0;
  } else if (connected === false) {
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
    bars = null;
  }
  const control = describeControl(controlStateName, controlState);

  const cols = w ?? 6;
  const rows = h ?? 5;
  // Wide-short: put the bars/headline cluster and the detail grid side-by-side so the width is used instead of clustering top-left.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 4;
  const showDetailGrid = rows >= 4 && cols >= 4;
  // Portrait stacks the route below the readout and needs more rows; below the threshold the caption keeps a hop-count hint.
  const showFullPath = cols >= 5 && (isLandscape ? rows >= 4 : rows >= 6);
  const hopHint =
    connected !== false && hops.length > 0 && !showFullPath
      ? relayCount === 0
        ? " (direct)"
        : ` (${relayCount} relay${relayCount === 1 ? "" : "s"})`
      : "";
  // Nulled when the link is not current, including the `control.label` fallback, which is read off the held `vessel.comms`.
  const headline = noSignal ? (
    NULL_DISPLAY
  ) : connected === false ? (
    "LOS"
  ) : pct !== null ? (
    <Unit value={value("%", pct * 100)} decimals={0} />
  ) : (
    control.label
  );

  // Announces only the connection-state transition; the streaming readout must not be a live region.
  const liveAnnouncement =
    connected === false
      ? "Signal lost"
      : connected === true
        ? "Signal connected"
        : "";
  return (
    <Panel
      panelTitle="COMMNET"
      sections={[
        <Section key="caption" full>
          <VisuallyHidden role="status" aria-live="polite">
            {liveAnnouncement}
          </VisuallyHidden>
          {showSubtitle && (
            <span
              style={{
                fontSize: "var(--font-size-caption)",
                color:
                  connected === false
                    ? "var(--color-status-nogo-fg)"
                    : "var(--color-text-dim)",
                letterSpacing: "0.04em",
              }}
            >
              {/* "Signal to <centre>" asserts a signal, so it nulls whenever the link verdict is absent or not current. */}
              {noSignal || connected === undefined
                ? NULL_DISPLAY
                : connected === false
                  ? "No signal"
                  : `Signal to ${centreLabel}${hopHint}`}
            </span>
          )}
        </Section>,
        <Section key="signal">
          <Cluster justify="start" wrap>
            <SignalBars
              bars={bars}
              tone={noSignal ? "neutral" : control.tone}
              noSignal={noSignal}
            />
            <SignalHeadline headline={headline} lost={connected === false} />
          </Cluster>
        </Section>,
        showDetailGrid && (
          <Section key="detail">
            <Grid
              cols="auto 1fr"
              gap="label-value"
              rowGap="readout-row"
              align="baseline"
            >
              <CommSignalDetailRows
                control={control}
                delay={delay}
                noSignal={noSignal}
              />
            </Grid>
          </Section>
        ),
        showFullPath && (
          <Section key="route">
            <CommsPathRoute
              hops={hops}
              vesselLabel={vesselLabel}
              centreLabel={centreLabel}
              pathDelay={delay}
              rateByHopId={rateByHopId}
            />
          </Section>
        ),
      ]}
    />
  );
}

const ROUTE_LABEL_STYLE = {
  color: "var(--color-text-dim)",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

const RAIL_WIDTH_PX = 20;
const RAIL_STOP_DIAMETER_PX = 10;

/**
 * The vertical train-schedule: vessel at the top, command centre at the
 * bottom, each leg's distance, light-time and contributed bitrate between its
 * two stops. Renders nothing for an empty `hops` list.
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
  /** The path's total one-way delay; an explicit null is not a delay of zero. */
  pathDelay: Value<"s"> | null | undefined;
  /** Per-hop forward bitrate (bits/sec) keyed by `commsHopId`. */
  rateByHopId: ReadonlyMap<string, number>;
}) {
  const nodes = buildCommsRouteNodes(hops, vesselLabel, centreLabel);
  if (nodes.length === 0) return null;
  const bottleneckId = commsBottleneckHopId(hops, rateByHopId);
  return (
    <Stack style={{ minWidth: 0 }}>
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
        gap: "var(--gap-related)",
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
 * One leg's distance, light-time and, when contributed, forward bitrate. The
 * bottleneck hop's rate is tinted amber, with a hidden hint and a hover title
 * so colour is never the only signal.
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
  pathDelay: Value<"s"> | null | undefined;
  /** This hop's forward bitrate (bits/sec), or undefined when none was contributed. */
  rate: number | undefined;
  /** Whether this hop is the path's minimum-rate (limiting) hop. */
  isBottleneck: boolean;
}) {
  const legTime = commsLegTime(hop, hops, pathDelay);
  const hasDetail = hop.distanceMeters !== undefined || rate !== undefined;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--gap-related)",
        minHeight: hasDetail ? undefined : "var(--size-comms-hop)",
      }}
    >
      <RailSlot stop={false} />
      {hasDetail && (
        <Cluster align="baseline" style={{ color: "var(--color-text-dim)" }}>
          {hop.distanceMeters !== undefined && (
            <Text tone="muted" size="xs">
              <Unit value={hop.distanceMeters} />
            </Text>
          )}
          {legTime !== undefined && (
            // `Countdown` renders a breaking space, unlike `Unit`, so it needs its own nowrap.
            <Text tone="muted" size="xs" style={{ whiteSpace: "nowrap" }}>
              <Countdown value={legTime} precise />
            </Text>
          )}
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
                // `Text`'s warn tone is the near-black chip foreground, so standalone warning text uses the muted token.
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
 * One row's slice of the dashed rail, plus the circle marker at a stop row.
 * Adjoining slots share an edge so the dashes read as one continuous rail.
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
            // The border is inside the diameter, or the circle sits off the rail's centre line.
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

// `neutral` is the no-verdict tone, not a severity between ok and warn.
type Tone = "ok" | "warn" | "lost" | "neutral";
const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
};

// Warning text uses the muted token: the bare warning `-fg` is near-black, meant for the chip.
const TONE_TEXT_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-fg)",
  neutral: "var(--color-text-primary)",
};

const BAR_HEIGHT_PCT = [30, 50, 75, 100];

/** The four-bar signal chart. */
function SignalBars({
  bars,
  tone,
  noSignal,
}: {
  bars: number | null;
  tone: Tone;
  noSignal?: boolean;
}) {
  return (
    <div
      role="img"
      /* "0 of 4" is itself a verdict, so a withheld glyph announces the badge's wording instead. */
      aria-label={
        noSignal
          ? "No signal"
          : bars === null
            ? "Signal unknown"
            : `Signal ${bars} of 4`
      }
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "var(--gap-signal-bars)",
        height: 24,
      }}
    >
      {[1, 2, 3, 4].map((i) => {
        const lit = bars !== null && i <= bars;
        const color = lit ? TONE_COLOR[tone] : "var(--color-border-subtle)";
        return (
          <span
            key={i}
            style={{
              width: 6,
              background: color,
              border: `1px solid ${color}`,
              // Off-scale on purpose: the 2px radius token rounds a 6px bar into a lozenge.
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
  noSignal,
}: {
  control: { label: string; tone: Tone };
  delay: Parameters<typeof Countdown>[0]["value"];
  /** Withholds the control row, which is read off the held `vessel.comms`. */
  noSignal?: boolean;
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
        style={{
          color: noSignal ? undefined : TONE_TEXT_COLOR[control.tone],
        }}
      >
        {noSignal ? NULL_DISPLAY : control.label}
      </Text>
      <Text tone="muted" size="xs" style={labelStyle}>
        Delay
      </Text>
      <Text tone="default" size="sm">
        {delay == null ? NULL_DISPLAY : <Countdown value={delay} precise />}
      </Text>
    </>
  );
}

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Signal bars, percentage, probe control state (full / partial / none), and signal delay from KSP's CommNet.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  component: CommSignalComponent,
  augmentSlots: ["comm-signal.sections"],
  // A contribution only computes for a slot its widget declares.
  contributionSlots: ["comm-signal.hop-rates"],
  // Connectivity is the freeze-exempt `comms.link`; `vessel.comms` holds its last value through a blackout.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
