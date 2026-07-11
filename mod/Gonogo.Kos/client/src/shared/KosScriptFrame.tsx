import { formatAge } from "@ksp-gonogo/core";
import {
  ActionButton,
  EmptyState,
  Panel,
  PanelTitle,
  Spinner,
  StatusIndicator,
  WidgetHeader,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * Panel frame shared by all widgets driven by a kOS script that emits a
 * JSON payload via [KOSDATA]. Supplies:
 *   - header with title, running spinner, Run button (command mode only)
 *   - collapsible error banner with script-error and JSON-parse-error paths
 *   - "stale data" freshness badge
 *
 * The widget itself owns the body (children). Built entirely from
 * `@ksp-gonogo/ui-kit` primitives — no bespoke styling lives here.
 */

export interface KosScriptFrameProps {
  title: string;
  running: boolean;
  /** Error from executeScript (rejection, timeout, proxy disconnect, etc.). */
  scriptError: Error | null;
  /** Error from parsing the JSON payload. */
  parseError: Error | null;
  /** ms since epoch of the last successful parse, or null if none yet. */
  lastGoodAt: number | null;
  /**
   * "Run" button callback. Omit to hide the button (e.g. interval mode, or
   * the widget isn't configured yet).
   */
  onRun?: () => void;
  /** Disable the Run button. */
  runDisabled?: boolean;
  /**
   * Interval-mode breaker has tripped — render a "paused" banner with a
   * Re-enable button instead of the regular error banner. The widget
   * stops dispatching while this is true.
   */
  paused?: boolean;
  /** Last KosScriptError message, surfaced under the paused banner. */
  pausedReason?: string | null;
  /** Re-enable callback. Required when `paused` is true. */
  onReEnable?: () => void;
  children: ReactNode;
}

export function KosScriptFrame({
  title,
  running,
  scriptError,
  parseError,
  lastGoodAt,
  onRun,
  runDisabled,
  paused,
  pausedReason,
  onReEnable,
  children,
}: KosScriptFrameProps) {
  const [errorOpen, setErrorOpen] = useState(false);
  // Paused supersedes the regular error banner — the underlying error
  // is preserved in `pausedReason` and shown under the Re-enable
  // affordance instead. Otherwise users get two stacked banners
  // saying the same thing.
  const err = paused ? null : (scriptError ?? parseError);
  const ageMs = lastGoodAt ? Date.now() - lastGoodAt : null;

  return (
    <Panel>
      <WidgetHeader
        title={<PanelTitle>{title}</PanelTitle>}
        actions={
          <>
            {running && <Spinner size={12} ariaLabel="running" />}
            {onRun && (
              <ActionButton
                type="button"
                onClick={onRun}
                disabled={runDisabled ?? running}
              >
                Run
              </ActionButton>
            )}
          </>
        }
      />
      {paused && (
        // Distinct tone (warn, not nogo) so users don't confuse "transient
        // error" with "I gave up" — nogo is reserved for the genuine
        // abort/failure path below.
        <StatusIndicator tone="warn" live>
          Paused — kOS errors
          {pausedReason && ` — ${pausedReason}`}
          {onReEnable && (
            <ActionButton type="button" onClick={onReEnable}>
              {" "}
              Re-enable
            </ActionButton>
          )}
        </StatusIndicator>
      )}
      {err && (
        <StatusIndicator tone="nogo" live>
          {scriptError ? "Script failed" : "Parse failed"}
          {ageMs !== null && ` — good data ${formatAge(ageMs)} ago`}
          <ActionButton
            type="button"
            onClick={() => setErrorOpen((o) => !o)}
            aria-label="Show error detail"
            aria-expanded={errorOpen}
          >
            {" "}
            {errorOpen ? "Hide" : "Details"}
          </ActionButton>
        </StatusIndicator>
      )}
      {errorOpen && err && (
        <EmptyState layout="inline">{err.message}</EmptyState>
      )}
      {children}
    </Panel>
  );
}
