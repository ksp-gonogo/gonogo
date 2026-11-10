import { Badge } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useId } from "react";
import styled from "styled-components";

/**
 * What each seat means, shared by the join page and the setup's start choice
 * so the two read alike. `commandCentre` follows a sentence naming the screen
 * at mission control.
 */
export const SEAT_TEXT = {
  commandCentre:
    "Your connection is based at the active command centre. You can lose connection to the active vessel, but command centre control is always available.",
  pilot:
    "A screen on the active vessel. Your connection is linked to the active vessel. You can lose connection to the command centre, but vessel data is always live and instant.",
} as const;

/** The two seats offered side by side, one card each. */
export function SeatCardList({ children }: { children: ReactNode }) {
  return <CardList>{children}</CardList>;
}

/**
 * One seat to pick, as a whole-card button: its title, what the seat means,
 * and an optional live fact. The button is named by the title alone and
 * described by the text, so a screen reader hears the choice first.
 */
export function SeatCard({
  title,
  children,
  fact,
  disabled,
  onChoose,
}: {
  title: string;
  children: ReactNode;
  fact?: string;
  disabled?: boolean;
  onChoose: () => void;
}) {
  const id = useId();
  return (
    <li>
      <SeatCard__Button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
      >
        <SeatCard__Title id={`${id}-title`}>{title}</SeatCard__Title>
        <SeatCard__Body id={`${id}-body`}>{children}</SeatCard__Body>
        {fact && (
          <SeatCard__Facts>
            <Badge tone="info" size="sm">
              {fact}
            </Badge>
          </SeatCard__Facts>
        )}
      </SeatCard__Button>
    </li>
  );
}

const CardList = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--gap-section-compact);
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
  }
`;

const SeatCard__Button = styled.button`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  width: 100%;
  padding: var(--inset-choice-card);
  text-align: left;
  font: inherit;
  color: var(--color-text-primary);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--color-info-text);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const SeatCard__Title = styled.span`
  font-size: var(--font-size-lg);
  font-weight: 700;
`;

const SeatCard__Body = styled.span`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-compact);
  font-size: var(--font-size-prose);
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;

const SeatCard__Facts = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related-compact);
  margin-top: auto;
`;
