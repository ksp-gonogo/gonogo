import { Button, PrimaryButton } from "@gonogo/ui";
import { useId } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import type { AnalyticsConsentService } from "./AnalyticsConsentService";

/**
 * Blocking boot-time consent ask. Shown on the MAIN screen only, and only
 * while consent is unanswered. Deliberately NOT built on the shared
 * `useModal` dialog: that one dismisses on Escape and backdrop click,
 * which would hide the ask without recording a choice and leave analytics
 * in limbo. Here the only ways out are Enable or Decline — both persist.
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

  const choose = (value: "enabled" | "disabled") => {
    service.set(value);
    onResolved?.();
  };

  return createPortal(
    <Backdrop>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <Title id={titleId}>Help improve gonogo?</Title>
        <Body id={descId}>
          Send anonymous technical logs and errors to the developer to help
          debugging. No mission data, no personal information — just crash
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
  z-index: 2000;
`;

const Dialog = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  max-width: 460px;
  width: 90vw;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
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
  line-height: 1.5;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;
