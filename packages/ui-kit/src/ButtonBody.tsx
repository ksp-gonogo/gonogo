import styled, { css } from "styled-components";
import type { ButtonSize, ButtonTone, ButtonVariant } from "./Button";
import { focusRing } from "./focusRing";
import { TONE_MARK, TONE_ON_STATUS, TONE_STATUS, TONE_TEXT } from "./tone";

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
 * Used by {@link ToggleButton} and {@link Button}, which add only the
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
  &[data-held-button] {
    position: relative;
  }

  /* A command that was refused, got no reply or never left edges in the warning colour and leaves the state's own fill alone. */
  &[data-command-edge="warn"] {
    border-color: var(--color-warn-mark);
  }
  /* The game said it will refuse the press: dimmed, with a dashed warning edge. */
  &[data-command-edge="blocked"] {
    border-style: dashed;
    border-color: var(--color-warn-mark);
    opacity: 0.5;
  }
  /* The stream to the mod is down: nothing can be sent. Dimmed, with a dotted edge. */
  &[data-stream="down"] {
    opacity: 0.5;
    border-style: dotted;
  }
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
    min-height: var(--touch-target);
    /* Wider on both axes: min-height only covers the vertical target. */
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--inset-control-small-touch)"
        : "var(--inset-control-touch)"};
  }

  ${({ $variant }) => ($variant === "text" ? TEXT_TOUCH : "")}
`;

/**
 * The glyph a {@link IconButton} draws: nothing around it at rest, a fill and an
 * edge together under the pointer, the go fill while pressed. The edge is an
 * inset shadow, so the box is the same size in every state.
 */
export const IconButton__Body = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  padding: var(--inset-glyph-button);
  border-radius: var(--radius-regular);
  transition: background var(--duration-fast), box-shadow var(--duration-fast), color var(--duration-fast);

  /* A target of at least 24 by 24 on a fine pointer, whatever size the caller draws the glyph at; a coarse pointer already gets the touch target. */
  @media (pointer: fine) {
    min-width: 24px;
    min-height: 24px;
  }

  @media (hover: hover) {
    &:hover:not(:disabled):not([aria-disabled="true"]):not([aria-pressed="true"]) {
      background: var(--color-surface-raised);
      box-shadow: inset 0 0 0 1px var(--color-border-strong);
      color: var(--color-text-primary);
    }
  }
  &:active:not(:disabled):not([aria-disabled="true"]) {
    ${filledLook("go")}
  }
  /* A command that was refused, got no reply or never left tints the glyph in the warning colour. */
  &[data-command-edge="warn"] {
    color: var(--color-warn-text);
  }
  /* A pressed glyph has its fill, so the warning is an edge on the box, as on a box toggle. */
  &[aria-pressed="true"][data-command-edge="warn"] {
    outline-width: 2px;
    outline-style: solid;
    outline-color: var(--color-warn-mark);
    outline-offset: -2px;
  }
  /* The game said it will refuse the press: the glyph is dimmed in the warning colour, with a dashed outline. */
  &[data-command-edge="blocked"] {
    color: var(--color-warn-mark);
    opacity: 0.5;
    outline-width: 1px;
    outline-style: dashed;
    outline-color: var(--color-warn-mark);
  }
  /* The stream to the mod is down: dimmed, with a dotted outline. */
  &[data-stream="down"] {
    opacity: 0.5;
    outline-width: 1px;
    outline-style: dotted;
    outline-color: currentColor;
  }
  &[aria-pressed="true"] {
    ${filledLook("go")}
  }
  ${focusRing}
  &:disabled,
  &[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`;
