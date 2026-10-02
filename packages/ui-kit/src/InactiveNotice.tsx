import styled from "styled-components";

/**
 * What an inactive panel or section takes: the reason as one line, or the
 * reason plus a hint at what would bring it back.
 *
 * @category Panel
 */
export type PanelInactiveReason = string | { reason: string; hint?: string };

/**
 * The one body an inactive panel or section draws in place of its content:
 * the reason, centred, announced politely.
 *
 * @category Panel
 */
export function InactiveNotice({ reason }: { reason: PanelInactiveReason }) {
  const { reason: message, hint } =
    typeof reason === "string" ? { reason, hint: undefined } : reason;
  return (
    <InactiveNotice__Body role="status" aria-live="polite">
      <InactiveNotice__Reason>{message}</InactiveNotice__Reason>
      {hint !== undefined && (
        <InactiveNotice__Hint>{hint}</InactiveNotice__Hint>
      )}
    </InactiveNotice__Body>
  );
}

const InactiveNotice__Body = styled.div`
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-caption);
  text-align: center;
  padding: var(--inset-refusal);
`;

const InactiveNotice__Reason = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const InactiveNotice__Hint = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-caption);
  letter-spacing: 0.04em;
`;
