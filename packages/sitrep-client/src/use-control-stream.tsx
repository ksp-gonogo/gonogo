import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { getControlChannel } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useMemo, useRef } from "react";
import { useUtNow } from "./context";
import {
  type ControlRange,
  type ControlSample,
  deriveStrip,
  exceedsDeadband,
  type LoggedSample,
  MIN_DELAY_SECONDS,
  normalize01,
  recordSample,
} from "./control-stream-model";
import { useCommand } from "./use-command";
import { useLatestValue } from "./use-stream";

/**
 * The magnitude of a readback field, whether or not it carries a unit.
 *
 * A control channel's read field is whatever the channel names, so it can be
 * a declared quantity (`vessel.control.throttle`, a ratio) or a bare number.
 */
function magnitudeOfMaybe(v: unknown): unknown {
  if (v !== null && typeof v === "object" && "magnitude" in v) {
    return (v as { magnitude: unknown }).magnitude;
  }
  return v;
}

/** Coalescing cadence: record one command + readback sample and (past the deadband) dispatch, at 10 Hz. */
const COALESCE_MS = 100;
/**
 * Skip a dispatch when the raw value moved less than this since the last
 * sent value, measured in the shared 0..1 band (both values normalised
 * before comparing, see `exceedsDeadband`), so the effective deadband is
 * the same fraction of visible travel on a "unit" (0..1) axis as on a
 * "signed" (-1..1) one.
 */
const DISPATCH_DEADBAND = 0.005;

export interface ControlStreamOptions {
  /** Human label for the axis (shown by the component). Defaults to the channel id's last segment. */
  label?: string;
  /** How the raw value maps into the shared 0..1 band. Default "unit" (throttle); pass "signed" for -1..1 axes. */
  range?: ControlRange;
  /**
   * Called once per ACTUAL dispatch (past the deadband, at most 10 Hz): the
   * PerfBudget seam. `@ksp-gonogo/sitrep-client` deliberately does NOT depend
   * on `@ksp-gonogo/core` (that would be a cycle: core imports this package,
   * see `websocket-transport.ts`'s `onStreamFrame` for the same shape), so
   * the `PerfBudget` itself lives in the consuming layer (`ControlDelayStream`
   * / `Navball`, which already depend on core) and records from this
   * callback, the same way `SitrepTelemetryProvider` wires `onStreamFrame`
   * to `SITREP_STREAM_BUDGET.record()`.
   */
  onDispatch?: () => void;
}

export interface ControlStream {
  id: string;
  label: string;
  /** One-way delay seconds; the strip spans 3x this. null / near-zero => the component renders nothing. */
  oneWaySeconds: number | null;
  /** Commanded path, now-left (age 0) to oldest (age ~ 3T), values in the shared 0..1 band. */
  inTransit: ControlSample[];
  /** Confirmed readback samples, populated for age ~ 2T..3T, empty when the axis has no readback. */
  echo: ControlSample[];
  /** Current commanded value in the shared 0..1 band. */
  current: number;
}

interface CommsDelayLike {
  oneWaySeconds: Value<"s"> | null;
}

/**
 * Span-based eviction for the derived-strip read path: drops samples older
 * than `span` (the delayed branch only, called from the `useMemo` below).
 * The MAX_SAMPLES cap itself is already enforced on every push by
 * `recordSample`, unconditionally, so it does not depend on this ever
 * running (see that function's doc for why: this branch is unreachable on
 * a direct/low-delay link, which is exactly the case that must still stay
 * bounded).
 */
function trimBySpan(ring: LoggedSample[], nowUt: number, span: number): void {
  while (ring.length > 0 && nowUt - ring[0].atUt > span) ring.shift();
}

/**
 * Dispatches `value` on the channel's delayed write half (coalesced at 10 Hz
 * with a deadband) and rolls the in-transit + confirmed-readback buffer for the
 * continuous sibling of `useCommand` + `InFlightList`. The echo is intrinsic:
 * the channel already knows its own readback topic/field (Plan 1's
 * `ControlChannelHandle`), so no back-channel is wired at the call site. Returns
 * the derived stream `<ControlDelayStream>` draws. Degrades to an inert stream
 * (null delay, empty buffers) when the channel id is unknown or no provider is
 * mounted, so a widget on a direct link pays nothing.
 */
export function useControlStream(
  channelId: string,
  value: number,
  options?: ControlStreamOptions,
): ControlStream {
  const channel = getControlChannel(channelId);
  const range = options?.range ?? "unit";
  const label = options?.label ?? channelId.split(".").pop() ?? channelId;

  // Hooks are called unconditionally with a stable order. When the channel is
  // unknown, writeCommand/readTopic fall back to inert strings and nothing sends.
  const command = useCommand(channel?.writeCommand ?? "");
  const commsDelay = useLatestValue<CommsDelayLike>("comms.delay");
  const readback = useLatestValue<Record<string, unknown>>(
    channel?.readTopic ?? "",
  );
  // `useUtNow` is `undefined` before a `TelemetryProvider`/clock exists; 0
  // is the same "not synced yet" seed `useCommand` falls back to for the
  // same reason.
  const nowUt = useUtNow() ?? 0;

  // `.magnitude`: the delay arrives wrapped from the decode, and every use
  // below is arithmetic on a span of seconds. Reading the object itself left
  // `oneWaySeconds` a `Value`, which compares as NaN against MIN_DELAY_SECONDS
  // and silently reported every channel as direct/no-delay.
  const oneWaySeconds = commsDelay?.oneWaySeconds?.magnitude ?? null;

  const commandRing = useRef<LoggedSample[]>([]);
  const readbackRing = useRef<LoggedSample[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const nowUtRef = useRef(nowUt);
  nowUtRef.current = nowUt;
  const lastSentRef = useRef<number | null>(null);
  const sendRef = useRef(command.send);
  sendRef.current = command.send;
  const onDispatchRef = useRef(options?.onDispatch);
  onDispatchRef.current = options?.onDispatch;

  // Latest readback value, mirrored into a ref every render (same pattern as
  // `valueRef`/`nowUtRef`) so the coalescing interval below can read it
  // without becoming an effect dependency of its own.
  // The readback field arrives wrapped when the contract declares a unit for
  // it (a throttle is a ratio), so the magnitude comes off here: the ring
  // below stores plain normalised numbers and the strip does arithmetic on
  // them. Left as-is, the `typeof echo === "number"` guard in the interval
  // rejected every sample and the echo track was permanently empty.
  const echoRaw = magnitudeOfMaybe(
    channel ? readback?.[channel.readField] : undefined,
  );
  const echoRawRef = useRef(echoRaw);
  echoRawRef.current = echoRaw;

  // `toArgs` mirrored into a ref for the same reason `echoRawRef` above is:
  // `getControlChannel` hands back a FRESH object (and a fresh `toArgs`
  // closure) on every call, so putting it directly in the interval effect's
  // dependency array would tear down and recreate the interval on every
  // render, resetting its 100ms cadence each time and starving it of an
  // uninterrupted window to ever fire under any steady stream of re-renders
  // (telemetry updates, the view clock's per-frame tick, ...). `hasChannel`
  // is a stable boolean (derived from `channelId`, which callers don't
  // change at runtime) so the interval is created once and left alone.
  const toArgs = channel?.toArgs;
  const toArgsRef = useRef(toArgs);
  toArgsRef.current = toArgs;
  const hasChannel = toArgs !== undefined;

  // Coalesced record + dispatch. One interval owns BOTH read halves: it
  // records a command sample AND a readback sample every tick (so both the
  // outgoing strip and the confirmed zone stay continuous held lines, not
  // just a single sample that ages out the moment the readback stops
  // changing), and dispatches the RAW command value only when it moved past
  // the deadband (so a held stick does not spam the uplink). Every push goes
  // through `recordSample`, which caps the ring at `MAX_SAMPLES`
  // unconditionally: the rings must stay bounded even while a widget sits on
  // a direct/low-delay link, where the span-based `trimBySpan` below is
  // never reached (the delayed branch short-circuits before it).
  useEffect(() => {
    if (!hasChannel) return;
    const id = setInterval(() => {
      const dispatch = toArgsRef.current;
      if (!dispatch) return;
      const raw = valueRef.current;
      recordSample(commandRing.current, {
        atUt: nowUtRef.current,
        value: normalize01(raw, range),
      });
      const echo = echoRawRef.current;
      if (typeof echo === "number" && Number.isFinite(echo)) {
        recordSample(readbackRing.current, {
          atUt: nowUtRef.current,
          value: normalize01(echo, range),
        });
      }
      const last = lastSentRef.current;
      if (
        last === null ||
        exceedsDeadband(raw, last, range, DISPATCH_DEADBAND)
      ) {
        lastSentRef.current = raw;
        onDispatchRef.current?.();
        void sendRef.current(dispatch(raw), { label });
      }
    }, COALESCE_MS);
    return () => clearInterval(id);
  }, [hasChannel, range, label]);

  return useMemo<ControlStream>(() => {
    if (oneWaySeconds === null || oneWaySeconds < MIN_DELAY_SECONDS) {
      return {
        id: channelId,
        label,
        oneWaySeconds,
        inTransit: [],
        echo: [],
        current: normalize01(value, range),
      };
    }
    const span = 3 * oneWaySeconds;
    trimBySpan(commandRing.current, nowUt, span);
    trimBySpan(readbackRing.current, nowUt, span);
    const { inTransit, echo } = deriveStrip({
      commandLog: commandRing.current,
      readbackLog: readbackRing.current,
      nowUt,
      oneWaySeconds,
    });
    return {
      id: channelId,
      label,
      oneWaySeconds,
      inTransit,
      echo,
      current: normalize01(value, range),
    };
  }, [channelId, label, oneWaySeconds, nowUt, value, range]);
}
