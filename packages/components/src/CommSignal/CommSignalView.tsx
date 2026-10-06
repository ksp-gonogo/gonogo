import type { ComponentProps } from "@ksp-gonogo/core";
import { useContributions, useTelemetry } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  EmptyState,
  Grid,
  getWidgetShape,
  HeldFigure,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
  Unit,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useMemo } from "react";
import { CommSignalDetailRows } from "./CommSignalDetailRows";
import { CommsPathRoute } from "./CommsPathRoute";
import { commsHopId, commsRouteRelayCount } from "./commsRoute";
import type { CommSignalConfig } from "./config";
import { SignalBars, SignalHeadline } from "./SignalBars";
import {
  connectionAnnouncement,
  hopHint,
  signalCaption,
} from "./signalVerdict";
import { useSignalVerdict } from "./useSignalVerdict";

/** Said while the craft's first word is still crossing the distance, which is not a lost link. */
export const AWAITING_FIRST_SIGNAL = "Awaiting first signal";

/** The figure beside the bars. Nulled when the link is held, including the control label, which is read off the held `vessel.comms`. */
function signalHeadline({
  noSignal,
  connected,
  percent,
  controlLabel,
}: {
  noSignal: boolean;
  connected: boolean | undefined;
  percent: ReactNode | null;
  controlLabel: string;
}): ReactNode {
  if (noSignal) return NULL_DISPLAY;
  if (connected === false) return "LOS";
  if (percent !== null) return percent;
  return controlLabel;
}

/** What the modelled mark on the strength means, on hover and in the spoken name. */
const MODELLED_STRENGTH =
  "Worked out for the path this command centre believes in, not measured";

/** What the held mark on the strength means where the figure is of a path this command centre does not believe in. */
const OTHER_PATH_STRENGTH =
  "Measured on the path the craft was using, which is not the path this command centre believes in";

export function CommSignalComponent({
  w,
  h,
}: Readonly<ComponentProps<CommSignalConfig>>) {
  const {
    connected,
    noSignal,
    nothingHasArrived,
    awaitingFirstSignal,
    pct,
    bars,
    control,
    strengthModelled,
    strengthOfOtherPath,
  } = useSignalVerdict();
  // Reckonable, but read observed-only because it is drawn in the verdicts' styling.
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

  /*
   * The empty state is for never-arrived only. A panel that has something
   * must not hide it when its verdicts are held: it renders with null lines
   * and the badge instead.
   */
  if (nothingHasArrived && !noSignal) {
    return (
      <Panel
        panelTitle="COMMNET"
        sections={
          <Section>
            <EmptyState>
              {awaitingFirstSignal ? AWAITING_FIRST_SIGNAL : "No signal data"}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  const cols = w ?? 6;
  const rows = h ?? 5;
  // Wide-short: put the bars/headline cluster and the detail grid side-by-side so the width is used instead of clustering top-left.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 4;
  const showDetailGrid = rows >= 4 && cols >= 4;
  // Portrait stacks the route below the readout and needs more rows; below the threshold the caption keeps a hop-count hint.
  const showFullPath = cols >= 5 && (isLandscape ? rows >= 4 : rows >= 6);
  const hint = hopHint({
    connected,
    hopCount: hops.length,
    relayCount,
    showFullPath,
  });
  const figure =
    pct === null ? null : <Unit value={value("%", pct * 100)} decimals={0} />;
  const strengthMark = strengthModelled
    ? ({ kind: "modelled", caption: MODELLED_STRENGTH } as const)
    : strengthOfOtherPath
      ? ({ kind: "held", caption: OTHER_PATH_STRENGTH } as const)
      : null;
  const percent =
    figure !== null && strengthMark !== null ? (
      <HeldFigure kind={strengthMark.kind} caption={strengthMark.caption}>
        {figure}
      </HeldFigure>
    ) : (
      figure
    );
  const headline = signalHeadline({
    noSignal,
    connected,
    percent,
    controlLabel: control.label,
  });

  const liveAnnouncement = connectionAnnouncement(connected);
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
                    ? "var(--color-nogo-text)"
                    : "var(--color-text-dim)",
                letterSpacing: "0.04em",
              }}
            >
              {signalCaption({ noSignal, connected, centreLabel, hint })}
            </span>
          )}
        </Section>,
        /* One section holding both blocks in a wrapping row: two grid sections would split the width into equal columns and leave the route a gulf away from the readouts. */
        <Section key="signal">
          <Cluster justify="start" align="start" gap="section" wrap>
            <Stack gap="related">
              <Cluster justify="start" wrap>
                <SignalBars
                  bars={bars}
                  tone={noSignal ? "neutral" : control.tone}
                  noSignal={noSignal}
                />
                <SignalHeadline
                  headline={headline}
                  lost={connected === false}
                />
              </Cluster>
              {showDetailGrid && (
                <Grid
                  cols="auto 1fr"
                  gap="label-value"
                  rowGap="related"
                  align="baseline"
                >
                  <CommSignalDetailRows
                    control={control}
                    delay={delay}
                    noSignal={noSignal}
                  />
                </Grid>
              )}
            </Stack>
            {showFullPath && (
              <CommsPathRoute
                hops={hops}
                vesselLabel={vesselLabel}
                centreLabel={centreLabel}
                pathDelay={delay}
                rateByHopId={rateByHopId}
              />
            )}
          </Cluster>
        </Section>,
      ]}
    />
  );
}
