import type { ButtonHTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
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
  /**
   * How the children sit. `stack` (default) is a column of lines. `split` is
   * one line whose first child takes the free width and whose other children
   * keep their own, for a name with a figure or tag trailing it.
   */
  layout?: "stack" | "split";
  /**
   * How `selected` reads. `fill` (default) floods the row in the go tone.
   * `outline` keeps the row's content on a raised ground edged in the accent,
   * for a row whose text should stay readable as it is.
   */
  selectedLook?: "fill" | "outline";
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
  layout = "stack",
  selectedLook = "fill",
  children,
  ...rest
}: SelectableRowProps) {
  return (
    <SelectableRow__Root
      type="button"
      aria-pressed={rest["aria-expanded"] === undefined ? selected : undefined}
      $selected={selected}
      $gap={gap}
      $layout={layout}
      $look={selectedLook}
      {...rest}
    >
      {children}
    </SelectableRow__Root>
  );
}

const SelectableRow__Root = styled.button<{
  $selected: boolean;
  $gap: GapToken;
  $layout: "stack" | "split";
  $look: "fill" | "outline";
}>`
  display: flex;
  ${({ $layout }) =>
    $layout === "split"
      ? css`
          justify-content: space-between;
          align-items: baseline;
          > :first-child {
            flex: 1;
            min-width: 0;
          }
        `
      : css`
          flex-direction: column;
        `}
  gap: ${({ $gap }) => GAP_VAR[$gap]};
  width: 100%;
  text-align: left;
  padding: var(--inset-selectable-row);
  border-radius: ${RADIUS_VAR.regular};
  border: 1px solid
    ${({ $selected, $look }) =>
      !$selected
        ? "var(--color-border-subtle)"
        : $look === "outline"
          ? "var(--color-accent-fg)"
          : "transparent"};
  ${({ $selected, $look }) =>
    !$selected
      ? "background: transparent; color: inherit;"
      : $look === "outline"
        ? "background: var(--color-surface-raised); color: inherit;"
        : statusFill("go")}
  cursor: pointer;
  font-family: inherit;

  ${({ $selected }) =>
    $selected
      ? ""
      : css`
          @media (hover: hover) {
            &:hover:not(:disabled):not([aria-disabled="true"]) {
              border-color: var(--color-border-strong);
            }
          }
        `}

  &:disabled,
  &[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }

  ${focusRing}
`;
