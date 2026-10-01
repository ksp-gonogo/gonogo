import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import styled, { css } from "styled-components";
import { focusRing } from "./focusRing";
import { TONE_MARK, TONE_ON_STATUS, TONE_STATUS, TONE_TEXT } from "./tone";

/**
 * How much a button asks to be pressed: `default` is the ordinary raised
 * control, `primary` the one commit action of a group, filled in its tone,
 * `ghost` the quiet secondary one beside it, and `text` no chrome at all, for
 * words that are themselves the control (a name that renames on click): it
 * takes its colour and type from the text around it.
 *
 * @category Button
 */
export type ButtonVariant = "default" | "primary" | "ghost" | "text";

/**
 * The state a button's action puts things in. `nogo` is the destructive tone,
 * `warn` an action that needs attention; `neutral` has no state.
 *
 * @category Button
 */
export type ButtonTone = Extract<Tone, "neutral" | "go" | "warn" | "nogo">;

/**
 * `sm` for dense rows, `md` otherwise; both sizes keep the kit's one control
 * height, and only the type and padding change.
 *
 * @category Button
 */
export type ButtonSize = "sm" | "md";

/**
 * A native button's attributes, plus how prominent it is, what its action
 * does, how large it is and, for a toggle, whether it is pressed.
 *
 * @category Button
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** How prominent the button is. Defaults to `default`. */
  variant?: ButtonVariant;
  /** Defaults to `go` for a primary button and `neutral` otherwise. */
  tone?: ButtonTone;
  /** Defaults to `md`. */
  size?: ButtonSize;
  /**
   * Makes the button a toggle: sets `aria-pressed` and, while true, draws the
   * one pressed look, filled in the tone's status colour. A pressed button
   * with no state of its own reads as on, so a neutral one fills in go.
   */
  pressed?: boolean;
}

/**
 * The kit's button: one family whose `variant` says how prominent it is and
 * whose `tone` says what its action does. Write the label in sentence case;
 * uppercase belongs to headings and state tokens. It takes no alignment of its
 * own: where it sits in a row is the caller's layout. The ref reaches the
 * `button` element.
 *
 * Its content is a centred flex row, so an icon beside the word centres on it
 * rather than sitting on the text baseline.
 *
 * @example
 * ```tsx
 * <Cluster justify="end">
 *   <Button variant="ghost" onClick={onCancel}>Cancel</Button>
 *   <Button variant="primary" onClick={onSave}>
 *     <CheckIcon />
 *     Save
 *   </Button>
 * </Cluster>
 * ```
 *
 * @category Button
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "default", tone, size = "md", pressed, ...rest },
    ref,
  ) {
    return (
      <Button__Body
        ref={ref}
        $variant={variant}
        $tone={tone ?? (variant === "primary" ? "go" : "neutral")}
        $size={size}
        $pressed={pressed === true}
        aria-pressed={pressed}
        {...rest}
      />
    );
  },
);

/** The fill a pressed button takes: its tone's status fill, and go for a neutral one. */
function pressedTone(tone: ButtonTone): Exclude<ButtonTone, "neutral"> {
  return tone === "neutral" ? "go" : tone;
}

/** Filled in a tone's status colour under its own text: a primary button, and every pressed one. */
export const filledLook = (tone: ButtonTone) => css`
  background: ${TONE_STATUS[tone]};
  border-color: ${TONE_STATUS[tone]};
  color: ${TONE_ON_STATUS[tone]};
`;

/** A toned outline: the tone's words on the button's own ground, edged in its mark. */
const tonedOutline = (tone: Exclude<ButtonTone, "neutral">) => css`
  border-color: ${TONE_MARK[tone]};
  color: ${TONE_TEXT[tone]};
`;

const VARIANT_LOOK = {
  default: css`
    background: var(--color-surface-raised);
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
  `,
  ghost: css`
    background: none;
    border-color: var(--color-border-strong);
    /* Clears 4.5:1 on the app background. */
    color: var(--color-text-muted);
  `,
} as const;

/* Words that are the control: the surrounding colour and type, with no box, so nothing but the focus ring says it is a button. */
const TEXT_LOOK = css`
  background: none;
  border: none;
  padding: 0;
  min-height: 0;
  font: inherit;
  color: inherit;
  text-align: inherit;
  justify-content: flex-start;

  /* No box to brighten, so the words underline under the pointer. */
  @media (hover: hover) {
    &:hover:not(:disabled) {
      text-decoration: underline;
    }
  }
`;

/* Words keep their place under a coarse pointer: the touch target grows, but no inset pushes the text off its line. */
const TEXT_TOUCH = css`
  @media (pointer: coarse) {
    padding: 0;
  }
`;

function variantLook(variant: ButtonVariant, tone: ButtonTone) {
  if (variant === "text") return TEXT_LOOK;
  if (variant === "primary") return filledLook(tone);
  if (tone === "neutral") return VARIANT_LOOK[variant];
  return css`
    ${VARIANT_LOOK[variant]}
    ${tonedOutline(tone)}
  `;
}

/* A filled button keeps its fill under the pointer; only an outlined one brightens its edge and words. */
const OUTLINE_HOVER = css`
  @media (hover: hover) {
    &:hover:not(:disabled) {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }
`;

const SIZE_LOOK = {
  sm: css`
    font-size: var(--font-size-caption);
    padding: var(--inset-control-small);
  `,
  md: css`
    font-size: var(--font-size-compact);
    padding: var(--inset-control);
  `,
} as const;

/**
 * The button's body, shared by every kit control that is a button:
 * `ToggleButton` and `CommandButton` draw with it and add only their own
 * behaviour's states.
 */
export const Button__Body = styled.button<{
  $variant: ButtonVariant;
  $tone: ButtonTone;
  $size: ButtonSize;
  $pressed: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-glyph-control);
  border: 1px solid;
  border-radius: var(--radius-regular);
  font-family: inherit;
  font-weight: 600;
  /* The kit's one control height, with a flush line height so type size cannot change the box height. */
  min-height: var(--control-height);
  line-height: var(--line-height-flush);
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);

  ${({ $size }) => SIZE_LOOK[$size]}
  ${({ $variant, $tone }) => variantLook($variant, $tone)}
  ${({ $pressed, $tone }) => ($pressed ? filledLook(pressedTone($tone)) : "")}

  ${({ $variant, $pressed }) =>
    $variant === "primary" || $variant === "text" || $pressed
      ? ""
      : OUTLINE_HOVER}
  ${focusRing}
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* An unconfirmed command may still run and a failed one never left; both read in the warning tone. */
  &[data-unconfirmed="true"],
  &[data-failed="true"] {
    border-color: var(--color-warn-mark);
    color: var(--color-warn-text);
    background: color-mix(
      in srgb,
      var(--color-warn-mark) 18%,
      var(--color-surface-raised)
    );
  }

  @media (pointer: coarse) {
    min-height: 44px;
    /* Wider on both axes: min-height only covers the vertical target. */
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--inset-control-small-touch)"
        : "var(--inset-control-touch)"};
  }

  ${({ $variant }) => ($variant === "text" ? TEXT_TOUCH : "")}
`;

/**
 * A subtle, underlined link-style `button` for a tertiary action inside copy
 * (such as "Clear all" in a list row). For a paired Cancel and Confirm row,
 * use a ghost {@link Button} beside a primary one.
 *
 * @category Button
 */
export const TextButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  transition: color var(--duration-fast);

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  ${focusRing}
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/**
 * An icon-only `button` with no chrome, just the glyph. Give it an
 * `aria-label`, since the icon inside is decorative. As a toggle, with
 * `aria-pressed`, it takes the filled pressed look while pressed. Under a
 * coarse pointer it grows to a 44px touch target.
 *
 * @example
 * ```tsx
 * <IconButton aria-label="Close" onClick={onClose}>
 *   <CloseIcon />
 * </IconButton>
 * ```
 *
 * @category Button
 */
export const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--inset-glyph-button);
  transition: color var(--duration-fast);

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  &[aria-pressed="true"] {
    border-radius: var(--radius-regular);
    ${filledLook("go")}
  }
  ${focusRing}
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`;
