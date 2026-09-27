import { useEffect } from "react";
import {
  ControlDelayStream,
  type ControlRibbonDatum,
  type ControlStreamDatum,
} from "./ControlDelayStream";
import {
  InFlightList,
  type InFlightListDensity,
  type InFlightListMode,
} from "./InFlightList";
import {
  type RailTags,
  railRendererFor,
  railTagKey,
  reportUnrepresentedRail,
} from "./railTags";
import {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./toInFlightListItems";

/**
 * The dev-only must-consume token a command handle carries. `<CommandDelay>`
 * flips `consumed` on mount; `useCommand`'s `send()` asserts it was flipped,
 * so a delayed command can never be dispatched without its delay UX rendered.
 * Absent in production.
 */
export type { CommandOutputToken } from "@ksp-gonogo/sitrep-sdk";

import type { CommandOutputToken } from "@ksp-gonogo/sitrep-sdk";
import type { CommandFoundEntry } from "./commandFoundSentence";
import type { CommandLossEntry } from "./commandLossSentence";
import type { CommandRefusalEntry } from "./commandRefusalSentence";
import type { CommandUndeliveredEntry } from "./commandUndeliveredSentence";

/**
 * The single delay-output handle every command widget hands to
 * `<CommandDelay>`. Declared structurally, with no dependency on the telemetry
 * spine; `useCommand`'s return value satisfies it.
 */
export interface CommandDelayHandle {
  /**
   * Discrete in-flight rows. Empty for a pure stream handle, and always empty
   * once `effectiveDelaySeconds` is 0 (nothing is ever in flight instantly).
   */
  inFlight: InFlightCommandLike[];
  /**
   * What this entry IS on the rail's three axes, in full. The renderer follows
   * from these, so no consumer branches on what kind of command this is. A
   * command handle gets them from `useCommand`; a producer that is not a
   * command (an open microphone) states them with `railTagsForTelemetry`.
   */
  tags: RailTags;
  /**
   * The command's effective one-way delay under its selected vantage. `0`
   * means nothing to visualise, so `<CommandDelay>` draws null (an instant
   * command still mounts it). `null` means the delay is unknown, which also
   * draws nothing but is not a claim of instant arrival.
   */
  effectiveDelaySeconds: number | null;
  /**
   * Stream buffers for a CONTINUOUS handle (the in-transit + confirmed-echo
   * samples `ControlDelayStream` draws). Ignored by the discrete queue.
   */
  streams?: ControlStreamDatum[];
  /**
   * Ribbon buffers: a continuous entry with amplitude history and no readback,
   * drawn in the rail's outgoing zone. Carried alongside `streams`, so a widget
   * with both a control axis and an open microphone gets one graph.
   */
  ribbons?: ControlRibbonDatum[];
  /**
   * What the rail should call this handle's graph, when "Delay detail" is not
   * what it is. A voice ribbon names the transmission it is drawing; a control
   * axis is happy with the default.
   */
  ariaLabel?: string;
  /**
   * The dev-only must-consume token (absent in production). `<CommandDelay>`
   * marks it consumed on mount so `useCommand`'s dispatch-time assertion
   * passes. A handle from a non-`useCommand` source simply omits it.
   */
  _output?: CommandOutputToken;
  /**
   * Dispatches from this command the GAME REFUSED, until dismissed. Rendered by
   * the Panel rail under both queues, never by `<CommandDelay>`: a refusal is
   * terminal and has nothing to do with delay.
   */
  refusals?: CommandRefusalEntry[];
  /**
   * Dispatches from this command that got NO ANSWER, until dismissed. Rendered
   * by the Panel rail, since a loss can have no in-flight entry at all. Apart
   * from `refusals` because a loss carries no verdict: the command may have
   * executed.
   */
  losses?: CommandLossEntry[];
  /**
   * Dispatches from this command that were called LOST and then answered after
   * all, until dismissed. An entry here has left `losses`: the same dispatch at
   * a later moment, never two boxes at once.
   */
  founds?: CommandFoundEntry[];
  /**
   * Dispatches from this command that NEVER LEFT this machine, until dismissed:
   * the command did not run. An entry here has left `losses`, as with `founds`.
   */
  undelivered?: CommandUndeliveredEntry[];
  /**
   * Clear a dead command (`overdue`/`lost`) from this handle's shared delay
   * queue, both in the widget-top queue and on the issuing control. When
   * present, the expanded queue's failed squares become clear buttons.
   */
  dismiss?: (id: string) => void;
}

export interface CommandDelayProps {
  /** A single command handle. Sugar for `handles={[handle]}`. */
  handle?: CommandDelayHandle;
  /**
   * Several command handles rendered as one merged list, for a widget whose
   * controls fire more than one command (e.g. a maneuver planner's
   * add/update/remove). Every handle's must-consume token is marked, and their
   * discrete in-flight rows are concatenated into a single `InFlightList`.
   */
  handles?: CommandDelayHandle[];
  /**
   * Accessible label for the rendered region. Left undefined, each branch
   * keeps its own default ("In-flight commands" / "Controls in flight").
   */
  ariaLabel?: string;
  /** Discrete-branch passthrough to `InFlightList`. Ignored for stream. */
  mode?: InFlightListMode;
  density?: InFlightListDensity;
  orientation?: "column" | "row";
  /**
   * `"inline"` (default) is the in-body rendering. `"rail"` (collapsed strip)
   * and `"expanded"` (grown detail) are what the Panel-owned rail passes,
   * forwarded to whichever child branch renders.
   */
  variant?: "inline" | "rail" | "expanded";
}

/**
 * The one delay-output component every delayed command flows through. It draws
 * nothing at zero delay, the continuous `ControlDelayStream` for a single
 * stream command, or the discrete `InFlightList` (merged across handles)
 * otherwise. A widget renders `<CommandDelay handle={cmd} />` and gets the
 * right delay UX with no per-widget branching.
 *
 * Rendering it also SATISFIES the must-consume invariant: it marks every
 * handle's `_output` token on mount (dev only), even when it draws nothing.
 */
export function CommandDelay({
  handle,
  handles,
  ariaLabel,
  mode,
  density,
  orientation,
  variant = "inline",
}: Readonly<CommandDelayProps>) {
  const all = handles ?? (handle ? [handle] : []);

  // Runs on every commit, so a handle added later is still marked.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const h of all) {
      if (h._output) h._output.consumed = true;
    }
  });

  /*
   * Which child draws a lone handle comes from the renderer table. Both
   * continuous forms land on the ONE graph. Never branch on delivery here:
   * whether a return leg is drawn is a decision inside the graph.
   */
  const lone = all.length === 1 ? all[0] : null;
  const loneRenderer = lone ? railRendererFor(lone.tags) : null;
  if (lone && loneRenderer === null) {
    return <UnrepresentedRailHandle tags={lone.tags} who={lone.ariaLabel} />;
  }
  if (lone && loneRenderer !== "in-flight-row") {
    const streamHandle = lone;
    // An unknown delay draws nothing, as an instant one does.
    const delay = streamHandle.effectiveDelaySeconds;
    if (delay === null || delay <= 0) return null;
    return (
      <ControlDelayStream
        streams={streamHandle.streams ?? []}
        ribbons={streamHandle.ribbons ?? []}
        ariaLabel={ariaLabel ?? streamHandle.ariaLabel}
        variant={variant}
      />
    );
  }

  /*
   * Discrete: merge every handle's in-flight rows. Not gated on
   * `effectiveDelaySeconds`, which a widget may not carry; an instant command
   * simply has no `inFlight` rows and `InFlightList` self-blanks.
   */
  const items = toInFlightListItems(all.flatMap((h) => h.inFlight));
  // A dismiss routes to the handle that owns the command.
  const canDismiss = all.some((h) => h.dismiss);
  const onDismiss = canDismiss
    ? (id: string) =>
        all.find((h) => h.inFlight.some((c) => c.id === id))?.dismiss?.(id)
    : undefined;
  return (
    <InFlightList
      items={items}
      ariaLabel={ariaLabel}
      mode={mode}
      density={density}
      orientation={orientation}
      variant={variant}
      onDismiss={onDismiss}
    />
  );
}

/**
 * A handle whose declared combination nothing draws, reported and left as a
 * `hidden` marker (`data-rail-unrepresented`) a probe can find. Never a
 * fallback to the discrete list, which would look right and be wrong.
 */
function UnrepresentedRailHandle({
  tags,
  who,
}: {
  tags: RailTags;
  who?: string;
}) {
  const named = who ?? "unnamed handle";
  reportUnrepresentedRail(tags, named);
  return <span hidden data-rail-unrepresented={railTagKey(tags)} />;
}
