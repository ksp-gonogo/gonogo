import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";
import { Button } from "./Button";
import { SendIcon } from "./Icons";

/**
 * The input at the foot of a console: a bordered, non-growing row whose OWN
 * BORDER says whether input is being accepted.
 *
 * The border is the point, and it is this component's rather than the frame's.
 * `ConsoleFrame` around it stays subtle and the accent lives HERE, so what the
 * operator sees outlined is the thing they type into. Wrapping the scrollback
 * and the input in one loud outline was tried and taken back out: it read as a
 * sealed console with a bottom section instead of a widget with a control in
 * it.
 *
 * The border takes `--console-tone-fg`, which `ConsoleFrame` declares from its
 * `tone`, so the input, its prompt glyph and its focus ring cannot come out in
 * different colours. Standing alone it falls back to the primary accent.
 *
 * ## The border turns when input is refused
 *
 * Both consumers refuse input at the input-acceptance step when there is no
 * comms path, before anything is cleared or dispatched, and a refusal the
 * operator only learns about by pressing the key is a refusal they read as a
 * bug. The error-toned outline says it on sight, while they are still typing,
 * and says it about the box they are looking at rather than in a badge
 * somewhere else on the widget.
 *
 * It styles the row and nothing inside it, with TWO exceptions: the send button
 * (`onSend`) and the prompt glyph (`prompt`). A terminal puts its composed text
 * and a blinking caret block in here, locked to the character pitch of the
 * emulator screen above; a message thread puts an input in. Neither font nor
 * pitch belongs to this component: an emulator's is a device-specific px
 * literal that has to equal the emulator's own JS font-size option, which is
 * one widget's problem and not the design system's.
 *
 * Whatever goes in sits FLUSH on the row. An `<input>` carrying its own outline
 * in here is a third box in a stack of three, which is what Commcast had and
 * what the alignment pass removed.
 */
export interface ComposerBarProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Input is not being accepted. Swaps the accent outline for the error one,
   * and tones `flag` to match.
   */
  blocked?: boolean;
  /**
   * A short chip straddling the row's top border, saying WHY, since an outline
   * that has turned red states the fact and not the cause.
   *
   * A string rather than a node: it is always a few upper-case words in the
   * row's own state tone, and the two widgets that render one would otherwise
   * each own a copy of the same chip. Pinned so it never changes the row's
   * height, which is the property that keeps a composer inside a short tile.
   */
  flag?: string;
  /**
   * The glyph that says "type here", at the head of the row and in the
   * console's tone.
   *
   * Here rather than in each console because it is the one thing both were
   * going to draw and only one of them had. Optional, because a composer whose
   * job is to CHOOSE rather than to type has nothing to prompt for: the
   * recipient picker sends on the same bar and gets no glyph.
   */
  prompt?: string;
  /**
   * Commit what is composed. Given, the row grows a send button at its far end;
   * omitted, it draws none and the composer's only send is whatever key it
   * binds.
   *
   * The button is an ADDITION to that key, never a replacement for it. A
   * console operator sends on Enter and always has; the button is for the one
   * on a touch screen with no keyboard up, and for anybody who cannot see that
   * a bordered box is waiting for Enter. So a caller wires this to the same
   * entry point its key handler already calls, rather than to a second copy of
   * the send path that can drift from it.
   *
   * It lives here rather than in each composer because the two that exist had
   * grown different answers: one had a button, the other had none, and the
   * operator moving between them had to remember which. It is also the one
   * child whose SIZE the row has an opinion about, hence not just a `children`
   * convention: a control that grows with the reading beside it reflows the
   * composer, so it carries the caller's verb and nothing else, and the figure
   * stays in the flag or in a badge. A console draws that verb as a glyph, see
   * `sendVariant`, which is the same argument taken one step further.
   */
  onSend?: () => void;
  /**
   * Refuse the press. Distinct from `blocked`, which is about the row as a
   * whole: a composer with nothing typed in it is perfectly able to accept
   * input and still has nothing to send.
   */
  sendDisabled?: boolean;
  /**
   * The verb. Defaults to "Send"; a console with a different one says so.
   *
   * It is the button's ACCESSIBLE NAME whichever way the button is drawn, so
   * moving a composer to the glyph never changes what a screen reader hears or
   * what a query for the control matches.
   */
  sendLabel?: string;
  /**
   * How to draw the verb. The glyph by default, because that is what a console
   * gets: the word is the widest thing on the row and it repeats what the
   * outlined box beside it already says.
   *
   * `"text"` is for a composer whose verb has no glyph, and it is the caller's
   * to justify. The recipient picker's verb is "Open", and a send arrow on it
   * would say the row transmits something. Defaulting the other way is what
   * keeps the consoles from growing two answers again: neither of them passes
   * this, so neither of them can drift.
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
        /* `role="status"`, never `alert`: a lost path is an ambient condition
           to note, not an interruption. */
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
  gap: var(--space-6);
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border: 1px solid
    ${({ $blocked }) =>
      $blocked
        ? "var(--color-status-nogo-fg)"
        : "var(--console-tone-fg, var(--color-accent-fg))"};
  border-radius: var(--radius-md);
`;

/*
 * No gap after it: a terminal's caret block must sit flush against the trailing
 * character of the composed line, so the row's own gap cannot be what separates
 * the glyph from the text. Its own margin instead.
 */
const ComposerBar__Prompt = styled.span`
  flex: 0 0 auto;
  color: var(--console-tone-fg, var(--color-accent-fg));
  font-weight: bold;
  margin-right: var(--space-8);
`;

/*
 * Pushed to the far end by its own auto margin rather than by a spacer the
 * caller has to remember: a terminal's composed line does not flex, so without
 * this the button sits against the last character typed and moves with every
 * keystroke.
 *
 * `font-size` is stated rather than inherited. The row is where a caller sets
 * an emulator's character pitch (a raw px literal locked to xterm's own option,
 * see the doc above), and a button drawn at the terminal's cell size is a
 * control sized by a device coincidence.
 */
const ComposerBar__Send = styled(Button)<{ $icon: boolean }>`
  flex: 0 0 auto;
  margin-left: auto;
  font-size: var(--font-size-xs);

  ${({ $icon }) =>
    $icon &&
    css`
      /* The glyph is centred in the box rather than sitting on the text
         baseline it no longer has, and the inset is squared off the vertical
         one so the button is a square and not a word-shaped gap. */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-6) var(--space-6);
      /* The tone the row is outlined in, so the one control on the bar reads as
         belonging to it rather than as chrome dropped on top. */
      color: var(--console-tone-fg, var(--color-accent-fg));

      @media (pointer: coarse) {
        padding: var(--space-8);
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
  right: var(--space-8);
  /* Local ordering against the row it is pinned to only; not app-global
     chrome, so not on the --z-* ladder. */
  z-index: 1;
  padding: var(--space-hair) var(--space-6);
  font-family: monospace;
  font-size: var(--font-size-2xs);
  font-weight: bold;
  letter-spacing: 0.04em;
  border-radius: var(--radius-md);

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
