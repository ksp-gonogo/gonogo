import { getDataSource } from "@gonogo/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isKosScriptError } from "../kos/KosScriptError";
import type { KosData, KosScriptArg } from "../kos/kos-data-parser";

/**
 * Interval-mode circuit breaker: after this many *consecutive* script
 * errors, the hook stops dispatching and surfaces a `disabled` flag so
 * the widget chrome can show a paused banner with a re-enable button.
 *
 * Consecutive (not windowed) is intentional — a flaky tick that
 * recovers shouldn't trip; a wedged kerboscript that fails every tick
 * should. Three at the typical 1Hz interval gives ~3s of error spam
 * before the dispatcher halts. Only `KosScriptError` (script-author
 * fault) counts; transport / proxy / timeout errors don't, because
 * those typically affect every widget at once and would auto-disable
 * the whole dashboard on a single hiccup.
 *
 * Command-mode dispatches are deliberately *not* breaker-gated — the
 * user is the loop; a button-mash isn't a runaway timer.
 */
const INTERVAL_BREAKER_THRESHOLD = 3;

/**
 * Widget-level arg: carries the type discriminant so config UIs can pick an
 * appropriate editor. "telemetry" args are resolved to a concrete number at
 * dispatch time by reading from the Telemachus data source (task 7).
 */
export type KosWidgetArg =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "telemetry"; key: string };

/**
 * Optional bundled-script payload forwarded to executeScript so the kOS
 * data source can keep the on-volume copy of `script` in sync with the
 * bundled body — see packages/app/src/dataSources/kosWrapper.ts. Defined
 * here (rather than in @gonogo/app) so widgets can pass it through the
 * hook without an app-package dependency.
 */
export interface KosManagedScript {
  /** Full bundled script body. */
  body: string;
  /** Stable hash of `body`; mismatch with the on-volume sidecar triggers a rewrite. */
  version: string;
}

export interface UseKosWidgetOptions {
  /** Name of the kOS CPU to target (tagname). */
  cpu: string;
  /** Name of the .ks script to run. */
  script: string;
  /** Widget-level args, resolved to concrete values at dispatch time. */
  args: KosWidgetArg[];
  /** "command" runs on explicit dispatch(); "interval" polls automatically. */
  mode: "command" | "interval";
  /** Required when mode === "interval". */
  intervalMs?: number;
  /** Data source id. Defaults to "kos". */
  sourceId?: string;
  /**
   * Id of the data source to resolve `{ type: "telemetry" }` args against.
   * Defaults to "data" (the BufferedDataSource wrapping Telemachus).
   */
  telemetrySourceId?: string;
  /**
   * When set, the data source auto-syncs `script` on the kOS volume to
   * `managed.body` before RUNPATH (versioned via `managed.version`).
   * Lets widgets ship updated kerboscripts without users having to copy
   * and paste each release. Sources that don't support managed scripts
   * (e.g. PeerClientDataSource today) just ignore the field.
   */
  managed?: KosManagedScript;
}

export interface UseKosWidgetResult {
  /** Most recent successful parse; persists across later failed runs. */
  data: KosData | null;
  /** Most recent error; cleared by the next successful run. */
  error: Error | null;
  /** True while a script is in flight. */
  running: boolean;
  /** Date.now() of the most recent successful run, or null. */
  lastGoodAt: number | null;
  /** Command-mode: explicitly trigger a run. No-op in interval mode. */
  dispatch: () => void;
  /**
   * True when interval mode has tripped its consecutive-error breaker
   * and is no longer dispatching. Always false in command mode.
   */
  disabled: boolean;
  /**
   * Human-readable reason the breaker tripped. Mirrors the last
   * `KosScriptError.message`. `null` whenever `disabled` is false.
   */
  disabledReason: string | null;
  /**
   * Re-arm the breaker and resume dispatching. Triggers an immediate
   * dispatch so the user gets feedback before the next interval tick.
   * No-op when not currently disabled.
   */
  reEnable: () => void;
}

interface KosExecutor {
  executeScript(
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed?: KosManagedScript,
  ): Promise<KosData>;
}

interface TelemetryReader {
  getLatestValue(key: string): unknown;
}

function coerceTelemetry(value: unknown): KosScriptArg {
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // Undefined / null / complex types: fall back to 0 rather than failing the
  // dispatch. Widgets that depend on telemetry should gate their own UI on
  // data availability before dispatching.
  return 0;
}

function resolveArg(
  arg: KosWidgetArg,
  telemetry: TelemetryReader | undefined,
): KosScriptArg {
  if (arg.type === "telemetry") {
    // Guard on method existence, not just the source — the optional chain
    // only handled `telemetry` being undefined. A PeerClientDataSource is
    // truthy but doesn't always implement getLatestValue.
    if (typeof telemetry?.getLatestValue !== "function") {
      return coerceTelemetry(undefined);
    }
    return coerceTelemetry(telemetry.getLatestValue(arg.key));
  }
  return arg.value;
}

function resolveArgs(
  args: KosWidgetArg[],
  telemetry: TelemetryReader | undefined,
): KosScriptArg[] {
  return args.map((a) => resolveArg(a, telemetry));
}

export function useKosWidget(opts: UseKosWidgetOptions): UseKosWidgetResult {
  const sourceId = opts.sourceId ?? "kos";
  const telemetrySourceId = opts.telemetrySourceId ?? "data";
  const [data, setData] = useState<KosData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [running, setRunning] = useState(false);
  const [lastGoodAt, setLastGoodAt] = useState<number | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);

  // Guard against overlapping dispatches and against state updates after
  // unmount. Both are refs so React renders don't reset the guard.
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  // Consecutive-script-error count for the interval breaker. Only
  // resets on a successful dispatch or an explicit reEnable() —
  // transport errors and component re-renders don't touch it.
  const consecutiveScriptErrorsRef = useRef(0);
  // After reEnable(), the breaker waits for the next dispatch to either
  // succeed (clears the flag) or fail (counts ONE error and rearms the
  // counter). Without this, a still-broken script trips the breaker on
  // its first re-attempt and the user can't tell whether the button
  // worked. Equivalent to "must succeed once before counting again,
  // with one free retry."
  const graceAfterReEnableRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve args fresh on each dispatch so telemetry values (task 7) reflect
  // the current tick, not the tick the widget mounted on.
  const argsRef = useRef(opts.args);
  argsRef.current = opts.args;
  const cpuRef = useRef(opts.cpu);
  cpuRef.current = opts.cpu;
  const scriptRef = useRef(opts.script);
  scriptRef.current = opts.script;
  // Same fresh-on-dispatch semantics — a managed payload that flips
  // version mid-flight should land on the next call without re-mounting.
  const managedRef = useRef(opts.managed);
  managedRef.current = opts.managed;

  // Stable across renders so the setInterval below doesn't tear down on
  // every state update. Reads refs/state directly via closures over
  // stable refs.
  const modeRef = useRef(opts.mode);
  modeRef.current = opts.mode;

  const dispatch = useCallback(() => {
    if (pendingRef.current) return;
    const source = getDataSource(sourceId) as unknown as
      | KosExecutor
      | undefined;
    if (!source || typeof source.executeScript !== "function") {
      setError(
        new Error(`kOS compute data source "${sourceId}" is not registered`),
      );
      return;
    }
    pendingRef.current = true;
    setRunning(true);
    const telemetry = getDataSource(telemetrySourceId) as unknown as
      | TelemetryReader
      | undefined;
    source
      .executeScript(
        cpuRef.current,
        scriptRef.current,
        resolveArgs(argsRef.current, telemetry),
        managedRef.current,
      )
      .then((result) => {
        if (!mountedRef.current) return;
        setData(result);
        setError(null);
        setLastGoodAt(Date.now());
        consecutiveScriptErrorsRef.current = 0;
        graceAfterReEnableRef.current = false;
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        const errObj = err instanceof Error ? err : new Error(String(err));
        setError(errObj);
        // Only script-author errors feed the breaker. Transport,
        // timeout, "source not registered" — not the user's fault, not
        // a runaway loop, doesn't trip.
        if (modeRef.current !== "interval" || !isKosScriptError(errObj)) {
          return;
        }
        if (graceAfterReEnableRef.current) {
          // Free retry after re-enable — burns the grace, doesn't count.
          graceAfterReEnableRef.current = false;
          return;
        }
        consecutiveScriptErrorsRef.current += 1;
        if (consecutiveScriptErrorsRef.current >= INTERVAL_BREAKER_THRESHOLD) {
          setDisabled(true);
          setDisabledReason(errObj.message);
        }
      })
      .finally(() => {
        pendingRef.current = false;
        if (mountedRef.current) setRunning(false);
      });
  }, [sourceId, telemetrySourceId]);

  const reEnable = useCallback(() => {
    if (!disabled) return;
    consecutiveScriptErrorsRef.current = 0;
    graceAfterReEnableRef.current = true;
    setDisabled(false);
    setDisabledReason(null);
    // Fire immediately so the user sees a fresh attempt rather than
    // waiting for the next interval tick. The interval effect re-runs
    // on `disabled` flipping (it's keyed on `disabled` below) and the
    // first dispatch from there would race this one — pendingRef
    // suppresses the duplicate, so it's safe to call now.
    dispatch();
  }, [disabled, dispatch]);

  // Interval mode: fire immediately on mount, then every intervalMs. The
  // dispatch() guard (pendingRef) makes overlapping ticks skip silently, so
  // a slow script can't buffer a backlog of RUNs.
  //
  // The breaker gates this effect on `disabled` — when the breaker
  // trips we tear the interval down entirely so no more bytes hit the
  // wire (the FPS-melter case). reEnable() flips `disabled` back to
  // false, which re-runs this effect and re-arms the timer.
  const intervalMs = opts.intervalMs;
  const mode = opts.mode;
  useEffect(() => {
    if (mode !== "interval") return;
    if (disabled) return;
    if (!intervalMs || intervalMs <= 0) return;
    dispatch();
    const id = setInterval(() => {
      dispatch();
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [mode, intervalMs, dispatch, disabled]);

  return useMemo(
    () => ({
      data,
      error,
      running,
      lastGoodAt,
      dispatch,
      disabled,
      disabledReason,
      reEnable,
    }),
    [
      data,
      error,
      running,
      lastGoodAt,
      dispatch,
      disabled,
      disabledReason,
      reEnable,
    ],
  );
}
