import { logger } from "@gonogo/core";
import type { KosData, UseKosWidgetOptions } from "@gonogo/data";
import { useKosWidget } from "@gonogo/data";
import { useMemo } from "react";

/**
 * Thin wrapper around `useKosWidget` for widgets whose kOS script emits a
 * single JSON-encoded field inside `[KOSDATA]`. The base contract is:
 *
 *   PRINT "[KOSDATA]" + fieldName + "=" + <json-string> + "[/KOSDATA]".
 *
 * Widgets get `{ payload, raw, error, running, lastGoodAt, dispatch }` where
 * `payload` is the decoded JSON or `null` if the script hasn't run yet / the
 * field is missing / parse fails. Parse failures are surfaced through
 * `parseError` so the UI can distinguish "script ran but the payload is
 * malformed" from "script crashed".
 *
 * The reusable bits intentionally stop here — widgets still own their own
 * rendering. See `@gonogo/components/src/ShipMap` for the first consumer.
 */

export interface UseKosScriptPayloadOptions<_T>
  extends Omit<UseKosWidgetOptions, "mode" | "intervalMs"> {
  /**
   * Key whose value in `[KOSDATA]` is a JSON-encoded payload.
   * Widget author must keep this aligned with what the kerboscript emits.
   */
  field: string;
  mode?: UseKosWidgetOptions["mode"];
  intervalMs?: UseKosWidgetOptions["intervalMs"];
}

export interface UseKosScriptPayloadResult<T> {
  payload: T | null;
  /** Raw KosData object in case the widget wants other fields (debug, counts, etc.). */
  raw: KosData | null;
  error: Error | null;
  parseError: Error | null;
  running: boolean;
  lastGoodAt: number | null;
  dispatch: () => void;
  /** Forwarded from useKosWidget — see that hook for breaker semantics. */
  disabled: boolean;
  disabledReason: string | null;
  reEnable: () => void;
}

export function useKosScriptPayload<T>(
  opts: UseKosScriptPayloadOptions<T>,
): UseKosScriptPayloadResult<T> {
  const { field, mode = "command", intervalMs, ...rest } = opts;
  const widget = useKosWidget({ ...rest, mode, intervalMs });

  const { payload, parseError } = useMemo((): {
    payload: T | null;
    parseError: Error | null;
  } => {
    if (!widget.data) return { payload: null, parseError: null };
    const raw = widget.data[field];
    if (raw === undefined) {
      return {
        payload: null,
        parseError: new Error(
          `[kos-script] expected field "${field}" in [KOSDATA] but none was emitted`,
        ),
      };
    }
    if (typeof raw !== "string") {
      // parseKosData coerces bare numerics to numbers; widget authors should
      // keep the payload as a string ("parts=[...]") to avoid that branch.
      return {
        payload: null,
        parseError: new Error(
          `[kos-script] expected field "${field}" to be a JSON string but got ${typeof raw}`,
        ),
      };
    }
    try {
      const parsed = JSON.parse(raw) as T;
      return { payload: parsed, parseError: null };
    } catch (e) {
      logger.warn("kos-script: JSON parse failed", {
        field,
        error: e instanceof Error ? e.message : String(e),
        // Quote the first 200 chars of the raw string to help debug; a full
        // dump would choke the log ring on large ship maps.
        preview: raw.slice(0, 200),
      });
      return {
        payload: null,
        parseError: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }, [widget.data, field]);

  return {
    payload,
    raw: widget.data,
    error: widget.error,
    parseError,
    running: widget.running,
    lastGoodAt: widget.lastGoodAt,
    dispatch: widget.dispatch,
    disabled: widget.disabled,
    disabledReason: widget.disabledReason,
    reEnable: widget.reEnable,
  };
}
