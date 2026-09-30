import styled from "styled-components";
import { fitBox } from "./fitBox";
import { focusRing } from "./focusRing";

/**
 * Props for {@link FilterChip}.
 *
 * @category FilterList
 */
export interface FilterChipProps {
  /** The chip's text, which is also its accessible name. */
  label: string;
  /** Whether the filter is on. Drives `aria-pressed` and the filled look. */
  selected: boolean;
  /** An optional count drawn after the label, such as how many rows the filter matches. */
  count?: number;
  /** Called on press; flip `selected` here. */
  onToggle: () => void;
}

/**
 * A pill-shaped toggle `button` for one filter term, with `aria-pressed`
 * following `selected` and an optional count after the label. It is what
 * {@link useRowFilter} draws for each contributed term; use it directly for a
 * filter row of your own.
 *
 * @example
 * ```tsx
 * <Cluster justify="start" wrap role="group" aria-label="Filters">
 *   {BODIES.map((body) => (
 *     <FilterChip
 *       key={body}
 *       label={body}
 *       selected={shown.has(body)}
 *       count={countFor(body)}
 *       onToggle={() => toggle(body)}
 *     />
 *   ))}
 * </Cluster>
 * ```
 *
 * @category FilterList
 */
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
