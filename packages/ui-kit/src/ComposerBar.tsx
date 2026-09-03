import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";
import { Button } from "./Button";

/**
 * The input row at the foot of a console: a bordered, non-growing row whose
 * OWN BORDER says whether input is being accepted.
 *
 * The border is the point. Both consumers refuse input at the input-acceptance
 * step when there is no comms path, before anything is cleared or dispatched,
 * and a refusal the operator only learns about by pressing the key is a
 * refusal they read as a bug. The error-toned outline says it on sight, while
 * they are still typing, and it says it about the box they are looking at
 * rather than in a badge somewhere else on the widget.
 *
 * It styles the row and nothing inside it, with ONE exception: the send button
 * (`onSend`). A terminal puts a prompt glyph, its composed text and a blinking
 * caret block in here, all locked to the character pitch of the emulator screen
 * above; a message thread puts an input in. Neither font nor pitch belongs to
 * this component: an emulator's is a device-specific px literal that has to
 * equal the emulator's own JS font-size option, which is one widget's problem
 * and not the design system's.
 *
 * It also does not own the space BELOW itself. A composer that opens a picker
 * or a toggle row under the bar wraps the whole stack in its own non-growing
 * box; this component is the bar.
 */
export interface ComposerBarProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Input is not being accepted. Swaps the accent outline for the error one,
   * and tones `flag` to match.
   */
  blocked?: boolean;
  /**
   * A short chip straddling the bar's top border, saying WHY, since an outline
   * that has turned red states the fact and not the cause.
   *
   * A string rather than a node: it is always a few upper-case words in the
   * bar's own state tone, and the two widgets that render one would otherwise
   * each own a copy of the same chip. Pinned so it never changes the bar's
   * height, which is the property that keeps a composer inside a short tile.
   */
  flag?: string;
  /**
   * Commit what is composed. Given, the bar grows a send button at its far end;
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
   * child whose SIZE the bar has an opinion about, hence not just a `children`
   * convention: a control that grows with the reading beside it reflows the
   * composer, so the label stays the caller's verb and the figure stays in the
   * flag or in a badge.
   */
  onSend?: () => void;
  /**
   * Refuse the press. Distinct from `blocked`, which is about the bar as a
   * whole: a composer with nothing typed in it is perfectly able to accept
   * input and still has nothing to send.
   */
  sendDisabled?: boolean;
  /** The verb. Defaults to "Send"; a console with a different one says so. */
  sendLabel?: string;
  children?: ReactNode;
}

export function ComposerBar({
  blocked = false,
  flag,
  onSend,
  sendDisabled = false,
  sendLabel = "Send",
  children,
  ...rest
}: ComposerBarProps) {
  return (
    <ComposerBar__Row $blocked={blocked} {...rest}>
      {children}
      {onSend !== undefined && (
        <ComposerBar__Send
          type="button"
          disabled={sendDisabled}
          onClick={onSend}
        >
          {sendLabel}
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
      $blocked ? "var(--color-status-nogo-fg)" : "var(--color-accent-fg)"};
  border-radius: var(--radius-md);
`;

/*
 * Pushed to the far end by its own auto margin rather than by a spacer the
 * caller has to remember: a terminal's composed line does not flex, so without
 * this the button sits against the last character typed and moves with every
 * keystroke.
 *
 * `font-size` is stated rather than inherited. The bar is where a caller sets
 * an emulator's character pitch (a raw px literal locked to xterm's own option,
 * see the doc above), and a button drawn at the terminal's cell size is a
 * control sized by a device coincidence.
 */
const ComposerBar__Send = styled(Button)`
  flex: 0 0 auto;
  margin-left: auto;
  font-size: var(--font-size-xs);
`;

const ComposerBar__Flag = styled.div<{ $blocked: boolean }>`
  position: absolute;
  /* Straddles the top border by half its OWN height, whatever that turns out
     to be. This replaced a hand-computed negative offset that had to be
     recomputed whenever the flag's font size moved, and did move: the 2xs
     token grows on a coarse pointer, i.e. on the Steam Deck, while a literal
     offset stayed put. */
  top: 0;
  transform: translateY(-50%);
  right: var(--space-8);
  /* Local ordering against the bar it is pinned to only; not app-global
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
