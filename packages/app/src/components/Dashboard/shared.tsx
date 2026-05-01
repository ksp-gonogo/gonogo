import { useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { usePushClient } from "../../pushToMain/PushClientContext";
import type { DashboardItem } from "./index";
import { handleMouseDown } from "./mouseHandlers";

// ---------------------------------------------------------------------------
// Remove button — two-click confirm pattern so a stray click in the drag
// header doesn't vaporise the widget.
// ---------------------------------------------------------------------------

const CONFIRM_WINDOW_MS = 3_000;

export function RemoveButton({ onRemove }: Readonly<{ onRemove: () => void }>) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirming) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      onRemove();
      return;
    }
    setConfirming(true);
    timerRef.current = setTimeout(() => {
      setConfirming(false);
      timerRef.current = null;
    }, CONFIRM_WINDOW_MS);
  }

  return (
    <RemoveBtn
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={confirming ? "Confirm remove" : "Remove widget"}
      title={confirming ? "Click again to confirm" : "Remove widget"}
      $confirming={confirming}
    >
      {confirming ? "✕?" : "✕"}
    </RemoveBtn>
  );
}

// ---------------------------------------------------------------------------
// Push-to-main toggle — only shown on stations (usePushClient() returns
// non-null when the PushClientProvider is mounted) and only for components
// that declared pushable: true at registration time.
// ---------------------------------------------------------------------------

export function PushButton({
  item,
  pushable,
  w,
  h,
}: Readonly<{
  item: DashboardItem;
  pushable: boolean;
  w: number;
  h: number;
}>) {
  const client = usePushClient();
  if (!pushable || !client) return null;
  const pushed = client.isPushed(item.i);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pushed) {
      client.recall(item.i);
    } else {
      client.push({
        widgetInstanceId: item.i,
        componentId: item.componentId,
        config: (item.config ?? {}) as Record<string, unknown>,
        width: w,
        height: h,
      });
    }
  };
  return (
    <PushBtn
      type="button"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={pushed ? "Recall from main" : "Push to main"}
      title={pushed ? "Recall from main" : "Push to main"}
      $pushed={pushed}
    >
      {pushed ? "⇦" : "⇪"}
    </PushBtn>
  );
}

// ---------------------------------------------------------------------------
// Widget error fallback — rendered in place of a crashed widget so the rest
// of the dashboard keeps working and the failure is visible instead of silent.
// ---------------------------------------------------------------------------

export function WidgetError({
  componentName,
  error,
  onRetry,
}: Readonly<{ componentName: string; error: Error; onRetry: () => void }>) {
  return (
    <WidgetErrorPanel role="alert">
      <WidgetErrorTitle>{componentName} crashed</WidgetErrorTitle>
      <WidgetErrorMessage>{error.message || String(error)}</WidgetErrorMessage>
      <WidgetErrorHint>
        Open the widget config to fix the inputs, then retry.
      </WidgetErrorHint>
      <WidgetErrorRetry type="button" onClick={onRetry}>
        Retry
      </WidgetErrorRetry>
    </WidgetErrorPanel>
  );
}

// ---------------------------------------------------------------------------
// Shared styles — used across Grid and Mobile branches.
// ---------------------------------------------------------------------------

const highlightPulse = keyframes`
  0% {
    box-shadow:
      0 0 0 2px var(--color-accent-fg),
      0 0 18px 4px rgba(0, 255, 136, 0.55);
  }
  100% {
    box-shadow:
      0 0 0 0 transparent,
      0 0 0 0 transparent;
  }
`;

export const highlightStyle = css`
  &[data-highlight="true"] {
    @media (prefers-reduced-motion: no-preference) {
      animation: ${highlightPulse} 1500ms ease-out 1;
    }
  }
`;

export const ComponentWrapper = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const RemoveBtn = styled.button<{ $confirming: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $confirming }) => ($confirming ? "var(--color-tag-red-fg)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: var(--color-status-nogo-fg);
  }
`;

const PushBtn = styled.button<{ $pushed: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $pushed }) => ($pushed ? "var(--color-status-info-fg)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: var(--color-status-info-fg);
  }
`;

const WidgetErrorPanel = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  text-align: center;
`;

const WidgetErrorTitle = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: var(--color-status-nogo-fg);
`;

const WidgetErrorMessage = styled.div`
  word-break: break-word;
  max-width: 90%;
  color: var(--color-status-nogo-fg);
`;

const WidgetErrorHint = styled.div`
  color: var(--color-text-muted);
`;

const WidgetErrorRetry = styled.button`
  margin-top: 4px;
  padding: 4px 10px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: var(--color-status-alert-muted);
  }
`;
