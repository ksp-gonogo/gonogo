import styled from "styled-components";
import { fitBox } from "./fitBox";

export interface FilterChipProps {
  label: string;
  selected: boolean;
  count?: number;
  onToggle: () => void;
}

export function FilterChip({
  label,
  selected,
  count,
  onToggle,
}: FilterChipProps) {
  return (
    <ChipButton
      type="button"
      $selected={selected}
      onClick={onToggle}
      aria-pressed={selected}
    >
      <span>{label}</span>
      {count !== undefined && <Count>{count}</Count>}
    </ChipButton>
  );
}

const ChipButton = styled.button<{ $selected: boolean }>`
  ${fitBox("chip")}
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-8);
  /* Stadium, not a corner: with 2px vertical padding a 12px radius already
     exceeds half the rendered height, so --radius-pill renders identically and
     survives a padding change. */
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  font-weight: 600;
  /* Sentence case, as a control rather than a Badge. It is pill-shaped and it
     sits among badges, but it is a real button carrying aria-pressed: the label
     is a filter the operator applies, and its own text (a vessel name, a
     status) is not the kit's to shout. */
  cursor: pointer;
  transition:
    background var(--duration-fast),
    border-color var(--duration-fast),
    color var(--duration-fast);

  background: ${({ $selected }) =>
    $selected ? "var(--color-accent-fg)" : "transparent"};
  color: ${({ $selected }) =>
    $selected ? "var(--color-text-inverse)" : "var(--color-text-dim)"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--color-accent-fg)" : "var(--color-border-subtle)"};

  &:hover {
    border-color: var(--color-accent-fg);
    color: ${({ $selected }) =>
      $selected ? "var(--color-text-inverse)" : "var(--color-text-primary)"};
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Count = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-2xs);
  opacity: 0.75;
`;
