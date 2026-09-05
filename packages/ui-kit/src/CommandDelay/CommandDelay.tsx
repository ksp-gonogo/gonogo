import { useEffect } from "react";
import {
  ControlDelayStream,
  type ControlStreamDatum,
} from "./ControlDelayStream";
import {
  InFlightList,
  type InFlightListDensity,
  type InFlightListMode,
} from "./InFlightList";
import { RailCrossing } from "./RailCrossing";
import { type RailTags, railDrawsReturnLeg, railTagsOf } from "./railTags";
import {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./toInFlightListItems";

/**
 * The dev-only must-consume token a command handle carries. `<CommandDelay>`
 * flips `consumed` on mount; `useCommand`'s `send()` asserts it was flipped,
 * so a delayed command can never be dispatched without its delay UX rendered.
 * Stripped in production (the field is absent), so this is never a prod cost.
 */
// Re-exported, not re-declared: an identical copy of a published type in a
// second published package is the shape that drifts silently.
export type { CommandOutputToken } from "@ksp-gonogo/sitrep-sdk";

import type { CommandOutputToken } from "@ksp-gonogo/sitrep-sdk";
import type { CommandFoundEntry } from "./CommandFoundList";
import type { CommandLossEntry } from "./CommandLossList";
import type { CommandRefusalEntry } from "./commandRefusalSentence";

/**
 * The single delay-output handle every command widget hands to
 * `<CommandDelay>`. Declared structurally here (not imported from
 * `@ksp-gonogo/sitrep-client`) so ui-kit stays the vanilla design system with
 * no dependency back on the telemetry spine: `useCommand`'s real return value
 * satisfies this shape at every call site.
 */
export interface CommandDelayHandle {
  /**
   * Discrete in-flight rows. Empty for a pure stream handle, and always empty
   * once `effectiveDelaySeconds` is 0 (nothing is ever in flight instantly).
   */
  inFlight: InFlightCommandLike[];
  /**
   * Which delay display this command uses: a discrete `InFlightList` of
   * one-shot dispatches, or the continuous `ControlDelayStream` strip for a
   * persistent per-frame axis (fly-by-wire). Comes from `commandShape(topic)`.
   */
  shape: "discrete" | "stream";
  /**
   * What this entry IS on the rail's three axes, for anything the default
   * assumption gets wrong. Omitted (the case for every command today) it reads
   * as a discrete command awaiting an ack, which is exactly what the rail
   * silently assumed before the axes had names.
   *
   * `shape` already answers the continuity axis, so a stream handle needs no
   * tag to be drawn continuous, and does NOT become fire-and-forget by being
   * continuous: a stream command's ack is the confirmed readback and its
   * deviance is expected-against-actual. See `railTags.ts`.
   */
  tags?: Partial<RailTags>;
  /**
   * The command's effective one-way delay under its selected vantage. `0`
   * (meta-vantage / a direct LAN link) means there is nothing to visualise, so
   * `<CommandDelay>` renders nothing: there is no exemption path, an instant
   * command still mounts `<CommandDelay>`, it just draws null.
   */
  effectiveDelaySeconds: number;
  /**
   * Stream buffers for `shape === "stream"` (the in-transit + confirmed-echo
   * samples `ControlDelayStream` draws). Ignored for a discrete handle.
   */
  streams?: ControlStreamDatum[];
  /**
   * The dev-only must-consume token (absent in production). `<CommandDelay>`
   * marks it consumed on mount so `useCommand`'s dispatch-time assertion
   * passes. A handle from a non-`useCommand` source simply omits it.
   */
  _output?: CommandOutputToken;
  /**
   * Dispatches from this command the GAME REFUSED, until dismissed. Rendered by
   * the Panel rail UNDER both queues, never by `<CommandDelay>`: a refusal is
   * terminal and has nothing to do with delay, so it does not belong in an
   * in-flight list or a stream strip. `useCommand().refusals` satisfies this
   * structurally; a handle from another source omits it.
   */
  refusals?: CommandRefusalEntry[];
  /**
   * Dispatches from this command that got NO ANSWER, until dismissed. Rendered
   * by the Panel rail beside the refusals, and for the same reason it renders
   * those: a loss can have no in-flight entry at all (the engine drops a
   * command for an unreachable subject before it mints a queue entry), so
   * neither an in-flight list nor a stream strip can carry it.
   *
   * Kept apart from `refusals` because a loss carries no verdict. Nothing was
   * decided, and the command may well have executed. `useCommand().losses`
   * satisfies this structurally; a handle from another source omits it.
   */
  losses?: CommandLossEntry[];
  /**
   * Dispatches from this command that were called LOST and then answered after
   * all, until dismissed. Rendered by the Panel rail beside the losses, in a
   * different tone: a loss is a warning about something that did not happen and
   * this is news about something that did.
   *
   * An entry here has left `losses`; the two are the same dispatch at different
   * moments, never two boxes to draw at once. `useCommand().founds` satisfies
   * this structurally; a handle from another source omits it.
   */
  founds?: CommandFoundEntry[];
  /**
   * Clear a dead command (`overdue`/`lost`) from this handle's shared delay
   * queue. Supplied by `useCommand` (acting on the shared per-grid-item
   * DelayStore, so a dismiss clears the entry in the widget-top queue AND on the
   * issuing control). When present, the expanded queue's failed squares become
   * real clear buttons. A non-`useCommand` handle omits it.
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
  /** Discrete-branch passthroughs, so a migrating widget keeps its current
   * `InFlightList` presentation without a bespoke render. Ignored for stream. */
  mode?: InFlightListMode;
  density?: InFlightListDensity;
  orientation?: "column" | "row";
  /**
   * `"inline"` (default) is the in-body rendering an inline `<CommandDelay>`
   * consumer gets (the monospace `InFlightList`, the 40px `ControlDelayStream`).
   * `"rail"` (collapsed 16px strip) / `"expanded"` (grown detail) are what the
   * Panel-owned rail passes, forwarded to whichever child branch renders. Kept a
   * prop, not hardcoded, so a widget that renders `<CommandDelay>` inline in its
   * own body is unaffected.
   */
  variant?: "inline" | "rail" | "expanded";
}

/**
 * The one delay-output component every delayed command flows through.
 * Shape-dispatches on the handle(s): nothing at zero effective delay (the
 * meta-vantage / direct-link instant case), the continuous
 * `ControlDelayStream` for a single stream command, or the discrete
 * `InFlightList` (merged across handles) otherwise. A command widget renders
 * exactly `<CommandDelay handle={cmd} />` (or `handles={[...]}`) and gets the
 * correct delay UX for free, with no per-widget branching.
 *
 * Rendering `<CommandDelay>` is also what SATISFIES the must-consume invariant:
 * it marks every handle's `_output` token on mount (dev only), which is how
 * `useCommand`'s `send()` knows the delay UX is present. It marks the token
 * even when it draws nothing (instant), so there is no exemption path.
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

  // Mark every handle's must-consume token (dev only). Runs on every commit so
  // a handle added to the array later is still marked; idempotent. Stripped in
  // production, where `_output` is absent anyway.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const h of all) {
      if (h._output) h._output.consumed = true;
    }
  });

  /*
   * The DELIVERY axis, before either ack-shaped renderer gets a look in.
   * `InFlightList` is a wait for a reply and `ControlDelayStream`'s last two
   * zones ARE one, so both are the wrong picture for an entry nothing answers:
   * they would draw a return leg that does not exist, which is the lie the
   * axes were named to remove. It crosses to the boundary and ends.
   */
  const tags = all.length > 0 ? railTagsOf(all[0]) : null;
  /*
   * EVERY handle, not just the first: a merged render of one acked command and
   * one fire-and-forget one has no single honest picture, so the ack-shaped
   * path keeps it rather than one handle's tag speaking for its siblings.
   */
  if (
    tags &&
    !railDrawsReturnLeg(tags) &&
    all.every((h) => !railDrawsReturnLeg(railTagsOf(h)))
  ) {
    const items = toInFlightListItems(all.flatMap((h) => h.inFlight));
    const leading = items[0];
    if (!leading) return null;
    return (
      <RailCrossing
        tags={tags}
        label={ariaLabel ?? "In flight, no reply expected"}
        progress={leading.progress}
        variant={variant}
      />
    );
  }

  // A lone stream handle draws the continuous strip; a stream's own delay is
  // gated inside ControlDelayStream, but the shared instant short-circuit still
  // applies here first.
  if (all.length === 1 && all[0].shape === "stream") {
    const streamHandle = all[0];
    if (streamHandle.effectiveDelaySeconds <= 0) return null;
    return (
      <ControlDelayStream
        streams={streamHandle.streams ?? []}
        ariaLabel={ariaLabel}
        variant={variant}
      />
    );
  }

  // Discrete (one or many handles): merge their in-flight rows into a single
  // list. `InFlightList` self-blanks on an empty set, so an instant command
  // (meta-vantage / direct link) shows nothing without a separate delay gate:
  // its `inFlight` is empty because nothing lingers in `system.uplink.pending`.
  // Deliberately NOT gated on `effectiveDelaySeconds`, that reads the global
  // `comms.delay` topic which a widget may not carry, and gating on it would
  // silently hide real in-flight rows; `inFlight` (from the carried
  // `system.uplink.pending`) is the correct, self-consistent signal.
  const items = toInFlightListItems(all.flatMap((h) => h.inFlight));
  // Route a dismiss to the handle that owns the command (each handle carries
  // its own `dismiss` from `useCommand`). Only offered when some handle can
  // dismiss, so a non-`useCommand` handle's failed squares stay inert.
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
