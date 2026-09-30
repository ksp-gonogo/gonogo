import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";
import { GAP_VAR, type GapToken, RADIUS_VAR } from "./scales";
import { statusFill } from "./tone";

/**
 * Props for {@link SelectableRow}. Any other `button` attribute passes
 * through, except `type`, which is always `button`.
 *
 * @category FilterList
 */
export interface SelectableRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /**
   * Highlights the row as the active pick in a select-one list (a tracked
   * rotor, a targeted servo). Drives the go-toned fill and defaults
   * `aria-pressed`, so a caller sets the boolean once.
   */
  selected: boolean;
  /**
   * Gap between the stacked lines of content (a name line over a muted meta
   * line). Defaults to `caption`.
   */
  gap?: GapToken;
  children?: ReactNode;
}

/**
 * A real `<button>` drawn as a full-width, left-aligned list row, for one
 * option in a pick-one list. It stacks its children vertically (typically a
 * name line over a muted meta line) and fills in the go tone while
 * `selected`. Text inherits the row's colour, so plain spans inside pick up
 * the selected tint. `aria-pressed` follows `selected`.
 *
 * @example
 * ```tsx
 * <Stack gap="rows">
 *   {servos.map((s) => (
 *     <SelectableRow
 *       key={s.id}
 *       selected={s.id === selectedId}
 *       onClick={() => select(s.id)}
 *     >
 *       <span>{s.name}</span>
 *       <Text level="muted" size="xs">{s.group}</Text>
 *     </SelectableRow>
 *   ))}
 * </Stack>
 * ```
 *
 * @category FilterList
 */
export function SelectableRow({
  selected,
  gap = "caption",
  children,
  ...rest
}: SelectableRowProps) {
  return (
    <SelectableRow__Root
      type="button"
      aria-pressed={selected}
      $selected={selected}
      $gap={gap}
      {...rest}
    >
      {children}
    </SelectableRow__Root>
  );
}

const SelectableRow__Root = styled.button<{
  $selected: boolean;
  $gap: GapToken;
}>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => GAP_VAR[$gap]};
  width: 100%;
  text-align: left;
  padding: var(--inset-selectable-row);
  border-radius: ${RADIUS_VAR.regular};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "transparent" : "var(--color-border-subtle)"};
  ${({ $selected }) =>
    $selected ? statusFill("go") : "background: transparent; color: inherit;"}
  cursor: pointer;

  ${focusRing}
`;
