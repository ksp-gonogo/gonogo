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
  children,
}: KosScriptFrameProps) {
  const [errorOpen, setErrorOpen] = useState(false);
  const err = scriptError ?? parseError;
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
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  overflow: hidden;
  font-family: monospace;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #141414;
  border-bottom: 1px solid #1f1f1f;
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #888;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Spinner = styled.span`
  font-size: 14px;
  color: #888;
`;

const RunButton = styled.button`
  background: #1f3a1f;
  border: 1px solid #2e5a2e;
  color: #cfe;
  font-family: monospace;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #2e5a2e;
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
  background: #3a1a1a;
  border: none;
  border-bottom: 1px solid #4a2a2a;
  color: #fbb;
  font-family: monospace;
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: #4a1e1e;
  }
`;

const ErrorLabel = styled.span`
  font-weight: 700;
`;

const ErrorMeta = styled.span`
  color: #c88;
  font-size: 10px;
`;

const ErrorDetail = styled.pre`
  background: #1a0d0d;
  color: #fbb;
  font-size: 11px;
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  border-bottom: 1px solid #2a1010;
`;
