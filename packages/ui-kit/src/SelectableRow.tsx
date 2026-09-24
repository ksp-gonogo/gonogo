import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";
import { RADIUS_VAR, SPACE_VAR, type SpaceToken } from "./scales";

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
   * line). Defaults to `xs`.
   */
  gap?: SpaceToken;
  children?: ReactNode;
}

/**
 * A real `<button>` styled as a full-width, left-aligned, two-line list row
 * that doubles as the active selection in a pick-one list. Stacks its children
 * vertically and go-tones its background/border when `selected`; text inherits
 * the row's own colour so children stay unstyled spans that pick up the
 * selected tint. Sets `aria-pressed` from `selected` automatically.
 *
 * Converged from RoboticsConsole's `ServoRow` and RotorTachometer's `RotorRow`,
 * which had each hand-rolled the same shape.
 */
export function SelectableRow({
  selected,
  gap = "xs",
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
  $gap: SpaceToken;
}>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => SPACE_VAR[$gap]};
  width: 100%;
  text-align: left;
  padding: ${SPACE_VAR.xs} ${SPACE_VAR.sm};
  border-radius: ${RADIUS_VAR.regular};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "transparent" : "var(--color-border-subtle)"};
  background: ${({ $selected }) =>
    $selected ? "var(--color-status-go-bg)" : "transparent"};
  color: ${({ $selected }) =>
    $selected ? "var(--color-status-go-fg)" : "inherit"};
  cursor: pointer;

  ${focusRing}
`;
