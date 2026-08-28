import { Button, PrimaryButton } from "@ksp-gonogo/ui";
import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { isolateModal } from "../a11y/modalIsolation";
import { useFocusTrap } from "../a11y/useFocusTrap";
import type { AnalyticsConsentService } from "./AnalyticsConsentService";

/**
 * Blocking boot-time consent ask. Shown on the MAIN screen only, and only
 * while consent is unanswered. Deliberately NOT built on the shared
 * `useModal` dialog: that one dismisses without recording a choice, which
 * would hide the ask and leave analytics in limbo. Every way out of this one
 * persists an answer, Escape included, where it counts as a decline.
 *
 * Being blocking is exactly why the keyboard handling below is not optional:
 * the app will not proceed until this is answered, so an operator who cannot
 * reach the buttons is locked out of the app, not merely inconvenienced. It
 * takes focus on open, traps Tab, and isolates everything behind it, none of
 * which it did when it shipped.
 *
 * Focus lands on Decline rather than Enable: a stray Return on a dialog the
 * operator has not read yet should not opt them into sending logs.
 *
 * Stations never render this; they follow the host's consent over PeerJS.
 */
export function AnalyticsConsentModal({
  service,
  onResolved,
}: {
  service: AnalyticsConsentService;
  onResolved?: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    return isolateModal(backdrop);
  }, []);

  const choose = useCallback(
    (value: "enabled" | "disabled") => {
      service.set(value);
      onResolved?.();
    },
    [service, onResolved],
  );

  // Escape answers as a decline. It has to answer rather than dismiss (see the
  // doc comment), but refusing to handle it at all was worse: Escape is the one
  // key a keyboard user reaches for to get out of a dialog, and this one gave
  // them nothing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      choose("disabled");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [choose]);

  return createPortal(
    <Backdrop ref={backdropRef}>
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <Title id={titleId}>Help improve gonogo?</Title>
        <Body id={descId}>
          Send anonymous technical logs and errors to the developer to help
          debugging. No mission data, no personal information, just crash
          reports and diagnostic traces. You can change this any time in
          Settings.
        </Body>
        <Actions>
          <Button type="button" onClick={() => choose("disabled")}>
            Decline
          </Button>
          <PrimaryButton type="button" onClick={() => choose("enabled")}>
            Enable
          </PrimaryButton>
        </Actions>
      </Dialog>
    </Backdrop>,
    document.body,
  );
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 2000 -> 10000. Both consent gates (this one and uplinks/consentModal) are
     the same class of never-occludable surface and never co-render, so one
     critical rung serves both. */
  z-index: var(--z-critical);
`;

const Dialog = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  max-width: 460px;
  width: 90vw;
  padding: var(--space-24);
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);

  &:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const Title = styled.h2`
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
`;

const Body = styled.p`
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-base);
  line-height: var(--line-height-prose);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--space-12);
`;
