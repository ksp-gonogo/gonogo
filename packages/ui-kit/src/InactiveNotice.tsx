import styled from "styled-components";

/**
 * Why a panel or section has nothing to show: the reason as one line, or the
 * reason plus a hint at what would bring it back. Useful for telling the
 * operator why a part of the screen is empty and what would change that. Taken
 * by the `inactive` prop of {@link Panel} and {@link Section}.
 *
 * @category Panel
 */
export type PanelInactiveReason =
  | string
  | {
      /** Why the panel is inactive. */
      reason: string;
      /** What would make it active, drawn under the reason. */
      hint?: string;
    };

/**
 * The body an inactive panel or section draws in place of its content: the
 * reason it is inactive, centred, with an optional hint under it at what would
 * bring it back. It is announced politely. Useful for telling the operator why
 * a part of the screen has nothing to show. Used by {@link Panel},
 * {@link Section} and {@link AugmentSlot}.
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
  /* Never shrinks below its text: a centred box squeezed under its content spills it upward over the title. */
  flex: 0 0 auto;
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
