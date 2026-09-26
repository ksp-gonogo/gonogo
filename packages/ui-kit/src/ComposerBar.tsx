import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";
import { Button } from "./Button";
import { SendIcon } from "./Icons";

/**
 * The input at the foot of a console: a bordered, non-growing row whose OWN
 * BORDER says whether input is being accepted. The accent lives here, not on
 * the surrounding `Console`, so what is outlined is what the operator types
 * into. The border takes `--console-tone-fg`, falling back to the primary
 * accent.
 *
 * The border turns error-toned when input is refused (no comms path), so the
 * operator sees it while typing rather than on pressing the key.
 *
 * It styles the row and nothing inside it except the send button (`onSend`)
 * and the prompt glyph (`prompt`); font and character pitch belong to the
 * caller. Whatever goes in sits FLUSH on the row, with no outline of its own.
 */
export interface ComposerBarProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Input is not being accepted. Swaps the accent outline for the error one,
   * and tones `flag` to match.
   */
  blocked?: boolean;
  /**
   * A short chip straddling the LEFT end of the row's top border, saying WHY
   * the outline turned red. The right end belongs to the console's delay
   * reading. A few upper-case words, pinned so it never changes the row's
   * height.
   */
  flag?: string;
  /**
   * The glyph that says "type here", at the head of the row and in the
   * console's tone. Optional: a composer that CHOOSES rather than types has
   * nothing to prompt for.
   */
  prompt?: string;
  /**
   * Commit what is composed. Given, the row grows a send button at its far end;
   * omitted, the only send is whatever key the composer binds.
   *
   * The button is an ADDITION to that key, for a touch screen with no keyboard
   * up. Wire it to the same entry point the key handler calls, not a second
   * copy of the send path. It carries the verb and nothing else, so it never
   * reflows the composer.
   */
  onSend?: () => void;
  /**
   * Refuse the press. Distinct from `blocked`, which is about the row as a
   * whole: a composer with nothing typed in it is perfectly able to accept
   * input and still has nothing to send.
   */
  sendDisabled?: boolean;
  /**
   * The verb. Defaults to "Send". It is the button's ACCESSIBLE NAME whichever
   * way the button is drawn.
   */
  sendLabel?: string;
  /**
   * How to draw the verb: the glyph by default. `"text"` is for a composer
   * whose verb has no glyph, such as "Open", where a send arrow would claim the
   * row transmits something.
   */
  sendVariant?: "icon" | "text";
  children?: ReactNode;
}

export function ComposerBar({
  blocked = false,
  flag,
  prompt,
  onSend,
  sendDisabled = false,
  sendLabel = "Send",
  sendVariant = "icon",
  children,
  ...rest
}: ComposerBarProps) {
  return (
    <ComposerBar__Row $blocked={blocked} {...rest}>
      {prompt !== undefined && (
        <ComposerBar__Prompt aria-hidden="true">{prompt}</ComposerBar__Prompt>
      )}
      {children}
      {onSend !== undefined && (
        <ComposerBar__Send
          type="button"
          disabled={sendDisabled}
          onClick={onSend}
          $icon={sendVariant === "icon"}
          {...(sendVariant === "icon" ? { "aria-label": sendLabel } : {})}
        >
          {sendVariant === "icon" ? <SendIcon size={16} /> : sendLabel}
        </ComposerBar__Send>
      )}
      {flag !== undefined && (
        // `role="status"`, never `alert`: a lost path is ambient, not an interruption.
        <ComposerBar__Flag $blocked={blocked} role="status">
          {flag}
        </ComposerBar__Flag>
      )}
    </ComposerBar__Row>
  );
}

const ComposerBar__Row = styled.div<{ $blocked: boolean }>`
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--gap-composer);
  padding: var(--inset-field);
  background: var(--color-surface-panel);
  border: 1px solid
    ${({ $blocked }) =>
      $blocked
        ? "var(--color-status-nogo-fg)"
        : "var(--console-tone-fg, var(--color-accent-fg))"};
  border-radius: var(--radius-regular);
`;

// Its own margin rather than the row's gap, since a terminal's caret block must sit flush against the composed line.
const ComposerBar__Prompt = styled.span`
  flex: 0 0 auto;
  color: var(--console-tone-fg, var(--color-accent-fg));
  font-weight: bold;
  margin-right: var(--gap-prompt-glyph);
`;

/*
 * Pushed to the far end by its own auto margin, so it never moves with each
 * keystroke. `font-size` is stated, not inherited from a terminal's character
 * pitch on the row.
 */
const ComposerBar__Send = styled(Button)<{ $icon: boolean }>`
  flex: 0 0 auto;
  margin-left: auto;
  font-size: var(--font-size-compact);

  ${({ $icon }) =>
    $icon &&
    css`
      /* The glyph is centred in the box rather than sitting on the text
         baseline it no longer has, and the inset is squared off the vertical
         one so the button is a square and not a word-shaped gap. */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--inset-icon-button);
      /* The tone the row is outlined in, so the one control on the bar reads as
         belonging to it rather than as chrome dropped on top. */
      color: var(--console-tone-fg, var(--color-accent-fg));

      @media (pointer: coarse) {
        padding: var(--inset-icon-button-touch);
      }
    `}
`;

const ComposerBar__Flag = styled.div<{ $blocked: boolean }>`
  position: absolute;
  /* Straddles the top border by half its OWN height, whatever that turns out to
     be. This replaced a hand-computed negative offset that had to be recomputed
     whenever the flag's font size moved, and did move: the 2xs token grows on a
     coarse pointer, i.e. on the Steam Deck, while a literal offset stayed put. */
  top: 0;
  transform: translateY(-50%);
  /* The LEFT end of that border, because the right one is spoken for: a console
     hangs its standing delay reading over the same edge, right-aligned to the
     column its queue's countdowns end in, and the two can be up together. A
     terminal reads its refusal and its separation off two topics that reveal on
     different clocks, so on a link coming back the separation is measurable
     again before the refusal clears, and both are drawn. They take opposite
     ends rather than being stacked, and neither has to know about the other.
     Over the prompt glyph reads well on its own terms too: a label at the head
     of the row it is refusing for. */
  left: var(--inset-console-foot);
  /* Local ordering against the row it is pinned to only; not app-global
     chrome, so not on the --z-* ladder. */
  z-index: 1;
  /* It overlaps the prompt glyph's top corner, and a word saying why the row is
     refusing input must not eat a press aimed at the control under it. */
  pointer-events: none;
  padding: var(--inset-chip);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-caption);
  font-weight: bold;
  letter-spacing: 0.04em;
  border-radius: var(--radius-regular);

  ${({ $blocked }) =>
    $blocked
      ? css`
          color: var(--color-status-nogo-on-bg);
          background: var(--color-status-nogo-bg);
          border: 1px solid var(--color-status-nogo-on-bg);
        `
      : css`
          color: var(--color-text-muted);
          background: var(--color-surface-panel);
          border: 1px solid var(--color-border-subtle);
        `}
`;
