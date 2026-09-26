import styled from "styled-components";
import { fitBox } from "./fitBox";
import { focusRing } from "./focusRing";

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
  gap: var(--gap-glyph-control);
  padding: var(--inset-control-small);
  /* --radius-pill keeps the stadium shape through a padding change. */
  border-radius: var(--radius-pill);
  font-size: var(--font-size-compact);
  font-weight: 600;
  /* Sentence case: a real toggle button rather than a Badge, and its label is not the kit's to shout. */
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

  ${focusRing}
`;

const Count = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-caption);
  opacity: 0.75;
`;
