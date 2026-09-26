import type { CommsHop, Value } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Countdown,
  Stack,
  Text,
  Unit,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import {
  buildCommsRouteNodes,
  type CommsRouteNode,
  commsBottleneckHopId,
  commsHopId,
  commsLegTime,
} from "./commsRoute";
import { CAPTION_LABEL_STYLE } from "./tones";

const RAIL_WIDTH_PX = 20;
const RAIL_STOP_DIAMETER_PX = 10;

/**
 * The vertical train-schedule: vessel at the top, command centre at the
 * bottom, each leg's distance, light-time and contributed bitrate between its
 * two stops. Renders nothing for an empty `hops` list.
 */
export function CommsPathRoute({
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
      <Text tone="muted" size="xs" style={CAPTION_LABEL_STYLE}>
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
