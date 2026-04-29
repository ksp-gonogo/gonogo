import type { ReactNode } from "react";
import { useState } from "react";
import styled from "styled-components";

/**
 * Panel frame shared by all widgets driven by a kOS script that emits a
 * JSON payload via [KOSDATA]. Supplies:
 *   - header with title, running spinner, Run button (command mode only)
 *   - collapsible error banner with script-error and JSON-parse-error paths
 *   - "stale data" freshness badge
 *
 * The widget itself owns the body (children). Matches the layout of
 * @gonogo/components/KosWidget so the visual language stays consistent.
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
      <Header>
        <Title>{title}</Title>
        <HeaderActions>
          {running && <Spinner aria-label="running">…</Spinner>}
          {onRun && (
            <RunButton
              type="button"
              onClick={onRun}
              disabled={runDisabled ?? running}
            >
              Run
            </RunButton>
          )}
        </HeaderActions>
      </Header>
      {paused && (
        <PausedBanner role="status" aria-live="polite">
          <PausedText>
            <PausedLabel>Paused — kOS errors</PausedLabel>
            {pausedReason && <PausedReason>{pausedReason}</PausedReason>}
          </PausedText>
          {onReEnable && (
            <ReEnableButton type="button" onClick={onReEnable}>
              Re-enable
            </ReEnableButton>
          )}
        </PausedBanner>
      )}
      {err && (
        <ErrorBanner
          type="button"
          onClick={() => setErrorOpen((o) => !o)}
          aria-label="Show error detail"
          aria-expanded={errorOpen}
        >
          <ErrorLabel>
            {scriptError ? "Script failed" : "Parse failed"}
          </ErrorLabel>
          {ageMs !== null && (
            <ErrorMeta>good data {formatAge(ageMs)} ago</ErrorMeta>
          )}
        </ErrorBanner>
      )}
      {errorOpen && err && <ErrorDetail>{err.message}</ErrorDetail>}
      {children}
    </Panel>
  );
}

function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

// ── Styles — mirror KosWidget intentionally ───────────────────────────────────

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  /* Without border-box, the 1px border overflows the parent and gets
     clipped by its overflow:hidden — leaving the left/right edges of
     the panel borderless. */
  box-sizing: border-box;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Spinner = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);
`;

const RunButton = styled.button`
  background: var(--color-status-go-bg);
  border: 1px solid var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: var(--color-status-go-bg);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ErrorBanner = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-status-alert-muted);
  border: none;
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: var(--color-status-alert-muted);
  }
`;

const ErrorLabel = styled.span`
  font-weight: 700;
`;

const ErrorMeta = styled.span`
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
`;

const ErrorDetail = styled.pre`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  border-bottom: 1px solid var(--color-tag-dark-brown-bg);
`;

// Paused banner — visually distinct from ErrorBanner so users don't
// confuse "transient error" with "I gave up". Uses the warn/alert
// surface, not the nogo surface; reserved nogo for the genuine
// abort/failure path.
const PausedBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--color-status-alert-muted);
  border-bottom: 1px solid var(--color-border-strong);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 6px 10px;
`;

const PausedText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PausedLabel = styled.span`
  font-weight: 700;
`;

const PausedReason = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ReEnableButton = styled.button`
  background: transparent;
  border: 1px solid var(--color-status-nogo-fg);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  flex-shrink: 0;
  &:hover {
    background: var(--color-surface-raised);
  }
`;
