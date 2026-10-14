import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import styled, { css } from "styled-components";
import {
  buttonTipText,
  reasonedDisabled,
  swallowPress,
  withButtonTip,
} from "./buttonTip";
import { focusRing } from "./focusRing";
import { HeldFigure } from "./HeldMark";
import type { ReckoningMarking } from "./readingCurrency";
import type { PredictedOutcome } from "./SendStatus/predictedOutcome";
import { TONE_MARK, TONE_ON_STATUS, TONE_STATUS, TONE_TEXT } from "./tone";

/**
 * How much a button asks to be pressed: `default` is the ordinary raised
 * control, `primary` the one commit action of a group, filled in its tone,
 * `ghost` the quiet secondary one beside it, and `text` no chrome at all, for
 * words that are themselves the control (a name that renames on click): it
 * takes its colour and type from the text around it. An underlined action
 * that reads as part of a sentence is a {@link TextButton} instead. Set with
 * the `variant` prop of {@link Button}.
 * Useful for telling the operator which control in a group is the main action
 * and which are secondary.
 *
 * @category Button
 */
export type ButtonVariant = "default" | "primary" | "ghost" | "text";

/**
 * The state a button's action puts things in. `nogo` is the destructive tone,
 * `warn` an action that needs attention; `neutral` has no state. Useful for
 * telling the operator how serious pressing a button is. Set with the `tone`
 * prop of {@link Button}.
 *
 * @category Button
 */
export type ButtonTone = Extract<Tone, "neutral" | "go" | "warn" | "nogo">;

/**
 * `sm` for dense rows, `md` otherwise; both sizes keep the kit's one control
 * height, and only the type and padding change. Set with the `size` prop of
 * {@link Button}.
 * Useful for fitting a button into a dense row or a roomier form.
 *
 * @category Button
 */
export type ButtonSize = "sm" | "md";

/**
 * A native button's attributes, plus how prominent it is, what its action
 * does, how large it is and, for a toggle, whether it is pressed. Taken by
 * {@link Button}.
 * Useful for describing a control the operator presses, with its prominence,
 * tone and size.
 *
 * @category Button
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** How prominent the button is. Defaults to `default`. */
  variant?: ButtonVariant;
  /**
   * What pressing the button does, as a status colour: `nogo` for a destructive
   * action, `warn` for one that needs attention. Defaults to `go` for a primary
   * button and `neutral` otherwise.
   */
  tone?: ButtonTone;
  /** Defaults to `md`. */
  size?: ButtonSize;
  /**
   * Makes the button a toggle: sets `aria-pressed` and, while true, draws the
   * one pressed look, filled in the tone's status colour. A pressed button
   * with no state of its own reads as on, so a neutral one fills in go.
   */
  pressed?: boolean;
  /**
   * The predicted result of pressing, drawn as a dashed edge in the button's own
   * border so its size does not change: `held` in the go colour with dashes, and
   * `at-risk` in the warning colour with the same dashes. It is drawn apart from the
   * keyboard focus ring, so both show at once, and a disabled button keeps its
   * disabled look. The tooltip says what the prediction is.
   */
  predictedOutcome?: PredictedOutcome;
  /**
   * Why the button is disabled, shown as its tip. With `disabled`, the button
   * is `aria-disabled` rather than natively disabled, so it keeps keyboard
   * focus and the tip can be reached; pressing it does nothing. A disabled
   * button with no reason says nothing about why, so give one wherever the
   * reason is known.
   */
  disabledReason?: string;
  /**
   * Marks the state the button shows as held or modelled, for a toggle whose
   * state comes from an old or late reading. The button stays pressable: the
   * label takes the kit's held mark, and the mark's words (hand it
   * {@link derivedMarking}, with what the press does added) are spoken after
   * the label and shown as its tip, so nothing is drawn beside it.
   */
  marked?: ReckoningMarking | null;
}

/**
 * The kit's button: one family whose `variant` says how prominent it is and
 * whose `tone` says what its action does. Useful for any action the operator
 * takes on this screen, such as saving a form or dismissing a banner. Used by
 * the source offline banner and the command block. Write the label in sentence
 * case; uppercase belongs to headings and state tokens. It takes no alignment
 * of its own: where it sits in a row is the caller's layout. The ref reaches
 * the `button` element. Its `type` is `"button"` unless the caller passes
 * `"submit"`, so a press inside a form submits nothing by default.
 *
 * Its content is a centred flex row, so an icon beside the word centres on it
 * rather than sitting on the text baseline.
 *
 * @example
 * ```tsx
 * import { Button, CheckIcon, Cluster } from "@ksp-gonogo/ui-kit";
 *
 * function SaveBar(props: { onCancel: () => void; onSave: () => void }) {
 *   return (
 *     <Cluster justify="end">
 *       <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
 *       <Button variant="primary" onClick={props.onSave}>
 *         <CheckIcon />
 *         Save
 *       </Button>
 *     </Cluster>
 *   );
 * }
 * ```
 *
 * @category Button
 * @categoryDescription Button
 * Buttons for things that happen on this screen: plain, icon and text buttons,
 * toggles, groups, and a button that fits its label to the space it has. A
 * button that sends a command to the game is a {@link CommandButton}.
 *
 * A button that is a glyph alone, or whose `aria-label` says more than its words
 * do, shows that name as a tip on hover and keyboard focus; a button whose words
 * are the whole story shows none. A disabled button given a `disabledReason`
 * shows the reason.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "default",
      tone,
      size = "md",
      pressed,
      predictedOutcome,
      disabledReason,
      marked,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const reasoned = reasonedDisabled(rest.disabled, disabledReason);
    const tip = buttonTipText({
      label: rest["aria-label"],
      children: rest.children,
      disabledReason: reasoned ? disabledReason : undefined,
    });
    const { disabled, onClick, children, ...passed } = rest;
    return withButtonTip(
      <Button__Body
        ref={ref}
        $variant={variant}
        $tone={tone ?? (variant === "primary" ? "go" : "neutral")}
        $size={size}
        $pressed={pressed === true}
        aria-pressed={pressed}
        data-predicted={predictedOutcome}
        {...passed}
        disabled={reasoned ? undefined : disabled}
        {...(reasoned ? { "aria-disabled": true } : {})}
        onClick={reasoned ? swallowPress : onClick}
        // After the caller's own props, so a button that passed a type keeps the attribute where it always sat.
        type={type}
      >
        {marked ? (
          <HeldFigure kind={marked.kind} caption={marked.caption}>
            {children}
          </HeldFigure>
        ) : (
          children
        )}
      </Button__Body>,
      tip,
      reasoned,
    );
  },
);

/** The fill a pressed button takes: its tone's status fill, and go for a neutral one. */
function pressedTone(tone: ButtonTone): Exclude<ButtonTone, "neutral"> {
  return tone === "neutral" ? "go" : tone;
}

/**
 * A button filled in a tone's status colour under its own text. Used by the
 * primary variant and by every pressed button.
 */
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
    &:hover:not(:disabled):not([aria-disabled="true"]) {
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
 * The styled `button` body that every kit control drawn as a button shares.
 * Used by {@link ToggleButton} and {@link CommandButton}, which add only the
 * states of their own behaviour.
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
  &:disabled,
  &[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* A predicted result changes the edge's line style and colour only, never its width, so the box stays the same size; both dashed because they are predictions, apart by colour and the tooltip. */
  &[data-predicted="held"]:not(:disabled) {
    border-style: dashed;
    border-color: var(--color-go-mark);
  }
  &[data-predicted="at-risk"]:not(:disabled) {
    border-style: dashed;
    /* Eased toward the ground so the amber is no louder than the go green beside it. */
    border-color: color-mix(
      in srgb,
      var(--color-warn-mark) 65%,
      var(--color-surface-raised)
    );
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
 * (such as "Clear all" in a list row). Useful for an action that should read as
 * part of the sentence around it. Used by the maneuver node list and the ship
 * diagram. It renders a native `button` and takes every prop that element does.
 * For a paired Cancel and Confirm row, use a ghost {@link Button} beside a
 * primary one. For words that are themselves the control and should keep the
 * surrounding text's colour and type, use a {@link Button} with
 * `variant="text"` instead.
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

const IconButton__Body = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--inset-glyph-button);
  transition: color var(--duration-fast);

  @media (hover: hover) {
    &:hover:not([aria-disabled="true"]) {
      color: var(--color-text-primary);
    }
  }
  &[aria-pressed="true"] {
    border-radius: var(--radius-regular);
    ${filledLook("go")}
  }
  ${focusRing}
  &:disabled,
  &[aria-disabled="true"] {
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

/**
 * Props for {@link IconButton}. Any other `button` attribute passes through.
 * Useful for giving a control that is a glyph alone its accessible name and
 * its press handler. Used by {@link IconButton}.
 *
 * @category Button
 */
export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Makes the button a toggle: sets `aria-pressed` and, while true, draws the pressed look. */
  pressed?: boolean;
  /** Why the button is disabled, shown as its tip. As for {@link Button}. */
  disabledReason?: string;
}

/**
 * An icon-only `button` with no chrome, just the glyph. Useful for compact
 * controls whose meaning an icon carries, such as closing a panel. Used by the
 * maneuver node rows and the connection settings. Give it an `aria-label`,
 * since the icon inside is decorative; the name is also its tip, so a glyph is
 * never unexplained. As a toggle, with `pressed`, it sets
 * `aria-pressed` and takes the filled pressed look while pressed. The ref
 * reaches the `button` element. Under a coarse pointer it grows to a 44px touch
 * target.
 *
 * @example
 * ```tsx
 * import { CloseIcon, IconButton } from "@ksp-gonogo/ui-kit";
 *
 * function CloseButton(props: { onClose: () => void }) {
 *   return (
 *     <IconButton aria-label="Close" onClick={props.onClose}>
 *       <CloseIcon />
 *     </IconButton>
 *   );
 * }
 * ```
 *
 * @category Button
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ pressed, disabledReason, ...rest }, ref) {
    const reasoned = reasonedDisabled(rest.disabled, disabledReason);
    const tip = buttonTipText({
      label: rest["aria-label"],
      children: rest.children,
      disabledReason: reasoned ? disabledReason : undefined,
    });
    const { disabled, onClick, ...passed } = rest;
    return withButtonTip(
      <IconButton__Body
        ref={ref}
        aria-pressed={pressed}
        {...passed}
        disabled={reasoned ? undefined : disabled}
        {...(reasoned ? { "aria-disabled": true } : {})}
        onClick={reasoned ? swallowPress : onClick}
      />,
      tip,
      reasoned,
    );
  },
);
