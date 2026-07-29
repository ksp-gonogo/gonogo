import { CloseIcon, PushUpIcon, RecallIcon } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { usePushClient } from "../../pushToMain/PushClientContext";
import type { DashboardItem } from "./index";
import { handleMouseDown } from "./mouseHandlers";

// ---------------------------------------------------------------------------
// Remove button: two-click confirm pattern so a stray click in the drag
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
      <CloseIcon size={12} />
      {confirming ? "?" : null}
    </RemoveBtn>
  );
}

// ---------------------------------------------------------------------------
// Push-to-main toggle: only shown on stations (usePushClient() returns
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
      {pushed ? <RecallIcon size={14} /> : <PushUpIcon size={14} />}
    </PushBtn>
  );
}

// ---------------------------------------------------------------------------
// Widget error fallback: rendered in place of a crashed widget so the rest
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
// Shared styles: used across Grid and Mobile branches.
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

/*
 * Both halves of this declaration stay off the motion scale.
 *
 * 1500ms is attention decay, not a UI transition, and it is locked to the
 * 2000ms fallback timer in `useScrollIntoViewOnAdd.ts` ("animation duration +
 * a margin") that clears `lastAddedId` for reduced-motion users, who never
 * fire `onAnimationEnd`. Retune one without the other and the highlight is
 * either stranded or cleared mid-pulse.
 *
 * `ease-out` stays literal too. The snap to --ease-standard is justified only
 * inside the 80ms-200ms band, where `ease` and `ease-out` are perceptually
 * identical; at 7.5x that duration `ease`'s slow-in ramp would hold the ring
 * near full brightness for the first ~400ms instead of decaying from frame one.
 *
 * The shorthand also has to stay INSIDE the reduced-motion guard. Hoisting it
 * out to reference duration/ease tokens at the rule's top level re-enables a
 * flashing green ring for reduced-motion users.
 */
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
  font-size: var(--font-size-xs);
  line-height: var(--line-height-flush);
  padding: var(--space-hair) var(--space-4);
  margin-left: var(--space-2);

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
  font-size: var(--font-size-sm);
  line-height: var(--line-height-flush);
  padding: var(--space-hair) var(--space-4);
  margin-left: var(--space-2);

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
  gap: var(--space-6);
  padding: var(--space-12);
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  text-align: center;
`;

const WidgetErrorTitle = styled.div`
  font-size: var(--font-size-sm);
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
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-10);
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover {
    background: var(--color-status-alert-muted);
  }
`;
