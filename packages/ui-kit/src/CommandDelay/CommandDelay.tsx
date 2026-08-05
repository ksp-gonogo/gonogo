import {
  ControlDelayStream,
  type ControlStreamDatum,
} from "./ControlDelayStream";
import {
  InFlightList,
  type InFlightListDensity,
  type InFlightListMode,
} from "./InFlightList";
import {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./toInFlightListItems";

/**
 * The single delay-output handle every command widget hands to
 * `<CommandDelay>`. Declared structurally here (not imported from
 * `@ksp-gonogo/sitrep-client`) so ui-kit stays the vanilla design system with
 * no dependency back on the telemetry spine: `useCommand`'s real return value
 * satisfies this shape at every call site. `_output` (the dev-only
 * must-consume token) is threaded in a later task and intentionally absent
 * here.
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
}

export interface CommandDelayProps {
  handle: CommandDelayHandle;
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
}

/**
 * The one delay-output component every delayed command flows through.
 * Shape-dispatches on the handle: nothing at zero effective delay (the
 * meta-vantage / direct-link instant case), the continuous
 * `ControlDelayStream` for a stream command, or the discrete `InFlightList`
 * otherwise. A command widget renders exactly `<CommandDelay handle={cmd} />`
 * and gets the correct delay UX for free, with no per-widget branching.
 */
export function CommandDelay({
  handle,
  ariaLabel,
  mode,
  density,
  orientation,
}: Readonly<CommandDelayProps>) {
  if (handle.effectiveDelaySeconds <= 0) return null;
  if (handle.shape === "stream") {
    return (
      <ControlDelayStream
        streams={handle.streams ?? []}
        ariaLabel={ariaLabel}
      />
    );
  }
  return (
    <InFlightList
      items={toInFlightListItems(handle.inFlight)}
      ariaLabel={ariaLabel}
      mode={mode}
      density={density}
      orientation={orientation}
    />
  );
}
