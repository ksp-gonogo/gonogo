import { CloseIcon, PushUpIcon, RecallIcon } from "@ksp-gonogo/ui";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { usePushClient } from "../../pushToMain/PushClientContext";
import type { DashboardItem } from "./index";
import { handleMouseDown } from "./mouseHandlers";

/**
 * Removes a widget from the dashboard. Pressing it swaps the control for a
 * labelled "Remove <name>?" prompt with Remove and Cancel buttons; Escape
 * cancels, and focus moves to Cancel on open and back to the remove button
 * on cancel.
 */
export function RemoveButton({
  onRemove,
  name = "widget",
}: Readonly<{ onRemove: () => void; name?: string }>) {
  const [confirming, setConfirming] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      return;
    }
    if (restoreFocus.current) {
      restoreFocus.current = false;
      removeRef.current?.focus();
    }
  }, [confirming]);

  function cancel() {
    restoreFocus.current = true;
    setConfirming(false);
  }

  if (confirming) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a group of two buttons, not a fieldset
      <ConfirmGroup
        role="group"
        aria-label={`Remove ${name}?`}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <ConfirmText>Remove {name}?</ConfirmText>
        <ConfirmBtn
          type="button"
          $danger
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          Remove
        </ConfirmBtn>
        <ConfirmBtn
          type="button"
          ref={cancelRef}
          onClick={(e) => {
            e.stopPropagation();
            cancel();
          }}
        >
          Cancel
        </ConfirmBtn>
      </ConfirmGroup>
    );
  }

  return (
    <Tooltip text={`Remove ${name}`}>
      <RemoveBtn
        ref={removeRef}
        type="button"
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        aria-label={`Remove ${name}`}
      >
        <CloseIcon size={12} />
      </RemoveBtn>
    </Tooltip>
  );
}

/**
 * Only shown on stations (`usePushClient()` returns non-null when the
 * `PushClientProvider` is mounted) and only for components that declared
 * `pushable: true` at registration time.
 */
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
    <Tooltip text={pushed ? "Recall from main" : "Push to main"}>
      <PushBtn
        type="button"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        aria-label={pushed ? "Recall from main" : "Push to main"}
        $pushed={pushed}
      >
        {pushed ? (
          <RecallIcon size="var(--icon-size-control)" />
        ) : (
          <PushUpIcon size="var(--icon-size-control)" />
        )}
      </PushBtn>
    </Tooltip>
  );
}

// Rendered in place of a crashed widget so the rest of the dashboard keeps working and the failure is visible instead of silent.
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

/*
 * The three glyph buttons in a tile's drag header take --inset-control-compact
 * rather than --inset-control, and the reason is a height rather than a
 * preference: `GridItemContent`'s CellHeader is 18px, and --inset-control is
 * the other half of --control-height's own definition at 28, so it would draw
 * a 24px box inside an 18px handle. The compact name is that arithmetic one
 * tier down, 2 inset + 2 border + a 14px glyph = 18. Grow the header first if
 * these should be real targets; the tray in MobileDashboard follows this for
 * the same reason.
 */
const RemoveBtn = styled.button`
  pointer-events: all;
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-flush);
  padding: var(--inset-control-compact);
  margin-left: var(--gap-glyph-tray);

  &:hover {
    color: var(--color-nogo-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const ConfirmGroup = styled.span`
  pointer-events: all;
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph-tray);
  margin-left: var(--gap-glyph-tray);
  font-size: var(--font-size-xs);
  white-space: nowrap;
`;

const ConfirmText = styled.span`
  color: var(--color-text-faint);
`;

const ConfirmBtn = styled.button<{ $danger?: boolean }>`
  background: none;
  border: 1px solid currentColor;
  border-radius: var(--radius-regular);
  color: ${({ $danger }) => ($danger ? "var(--color-tag-red-fg)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-flush);
  padding: var(--inset-control-compact);

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const PushBtn = styled.button<{ $pushed: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $pushed }) => ($pushed ? "var(--color-info-mark)" : "var(--color-text-faint)")};
  cursor: pointer;
  line-height: var(--line-height-flush);
  padding: var(--inset-control-compact);
  margin-left: var(--gap-glyph-tray);

  &:hover {
    color: var(--color-info-text);
  }
`;

const WidgetErrorPanel = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  padding: var(--inset-tile-message);
  background: var(--color-nogo-muted);
  border: 1px solid var(--color-nogo-muted);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  text-align: center;
`;

const WidgetErrorTitle = styled.div`
  font-size: var(--font-size-value);
  font-weight: bold;
  color: var(--color-nogo-text);
`;

const WidgetErrorMessage = styled.div`
  word-break: break-word;
  max-width: 90%;
  color: var(--color-nogo-text);
`;

const WidgetErrorHint = styled.div`
  color: var(--color-text-muted);
`;

const WidgetErrorRetry = styled.button`
  margin-top: var(--gap-actions);
  padding: var(--inset-control);
  background: var(--color-nogo-muted);
  border: 1px solid var(--color-nogo-muted);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  cursor: pointer;
  &:hover {
    background: var(--color-nogo-muted);
  }
`;
