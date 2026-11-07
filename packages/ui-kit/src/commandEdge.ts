import { css } from "styled-components";

/**
 * The room an input holds for the word that says what became of its command,
 * the widest being "No reply" with its letter spacing, so the input is the same
 * size at rest and in every phase.
 */
export const COMMAND_WORD_ROOM = "10ch";

/**
 * The edge of a command input that shows what became of its command, for an
 * element that draws a border: warning colour after a refusal or no reply, a
 * dashed warning edge when the game will refuse the press, a dotted dim one
 * when the stream is down, and a dashed edge for a predicted result. Only the
 * line style and colour change, never the width, so the box keeps its size.
 */
export const commandEdge = css`
  &[data-command-edge="warn"] {
    border-color: var(--color-warn-mark);
  }
  &[data-command-edge="blocked"] {
    border-style: dashed;
    border-color: var(--color-warn-mark);
    opacity: 0.5;
  }
  &[data-stream="down"] {
    opacity: 0.5;
    border-style: dotted;
  }
  &[data-predicted="held"] {
    border-style: dashed;
    border-color: var(--color-go-mark);
  }
  &[data-predicted="at-risk"] {
    border-style: dashed;
    border-color: color-mix(
      in srgb,
      var(--color-warn-mark) 65%,
      var(--color-surface-raised)
    );
  }
  &[aria-disabled="true"] {
    cursor: not-allowed;
  }
`;

/**
 * The same edge for an element with no border of its own, a row or a slider's
 * track, drawn as an outline inside the box so its size and its neighbours never
 * move. Spelled with the longhands, since these are state edges and not focus rings.
 */
export const commandOutlineEdge = css`
  &[data-command-edge="warn"] {
    outline-width: 1px;
    outline-style: solid;
    outline-color: var(--color-warn-mark);
    outline-offset: -1px;
  }
  &[data-command-edge="blocked"] {
    outline-width: 1px;
    outline-style: dashed;
    outline-color: var(--color-warn-mark);
    outline-offset: -1px;
    opacity: 0.5;
  }
  &[data-stream="down"] {
    opacity: 0.5;
    outline-width: 1px;
    outline-style: dotted;
    outline-color: currentColor;
    outline-offset: -1px;
  }
  &[data-predicted="held"] {
    outline-width: 1px;
    outline-style: dashed;
    outline-color: var(--color-go-mark);
    outline-offset: -1px;
  }
  &[data-predicted="at-risk"] {
    outline-width: 1px;
    outline-style: dashed;
    outline-color: color-mix(
      in srgb,
      var(--color-warn-mark) 65%,
      var(--color-surface-raised)
    );
    outline-offset: -1px;
  }
  &[aria-disabled="true"] {
    cursor: not-allowed;
  }
`;
