import styled from "styled-components";
import { focusRing } from "./focusRing";

/**
 * Default action button: neutral dark style, sentence case. Uppercase is
 * reserved for headings and state tokens, so case tells an instrument from a
 * control; the label text is the caller's.
 *
 * A flex row, so an icon beside the word (`<Button><PlusIcon />New
 * message</Button>`) centres rather than sitting on the text baseline.
 */
export const Button = styled.button`
  /* Centres an icon against the word beside it; see the note above. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-glyph-control);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  font-weight: 600;
  padding: var(--inset-control);
  /* The kit's one control height, so a button lines up with the toggles and
     readouts it shares a bar with. Flush line height with it: left at the
     browser's "normal" the box is sized by descender headroom this chrome text
     never uses, which is how two buttons a rung apart in type came out
     different heights. See --control-height in tokens.css. */
  min-height: var(--control-height);
  line-height: var(--line-height-flush);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast);

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }
  &:active {
    background: var(--color-border-subtle);
  }
  ${focusRing}
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @media (pointer: coarse) {
    min-height: 44px;
    /* Wider than the base inset on the horizontal as well as the vertical:
       min-height only covers the vertical target, so this is what keeps a
       touch-sized horizontal one. */
    padding: var(--inset-control-touch);
  }
`;

/** Confirm / save: green accent */
export const PrimaryButton = styled(Button)`
  background: var(--color-status-go-bg);
  border-color: var(--color-status-go-bg);
  color: var(--color-accent-fg);
  align-self: flex-end;

  @media (hover: hover) {
    &:hover {
      background: var(--color-status-go-bg);
      border-color: var(--color-status-go-bg);
      color: var(--color-accent-fg);
    }
  }
`;

/** Ghost / cancel: no background */
export const GhostButton = styled(Button)`
  background: none;
  border-color: var(--color-border-strong);
  /* Clears 4.5:1 on the app background. */
  color: var(--color-text-muted);

  @media (hover: hover) {
    &:hover {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }
`;

/**
 * Inline subtle link-style button for tertiary actions inside copy (e.g.
 * "Clear all" in a list row). For a paired Cancel / Confirm row, prefer
 * GhostButton + PrimaryButton.
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

/** Icon-only button: no chrome, just text/icon */
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
