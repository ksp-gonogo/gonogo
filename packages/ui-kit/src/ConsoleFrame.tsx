import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * The BOX a console is drawn in: a scrolling surface that takes the remaining
 * height of a panel body, with whatever the operator types into sitting INSIDE
 * it at the foot. Reached through `Console`, not exported bare.
 *
 * The nesting is exactly two deep: a quiet frame with a SUBTLE border, and one
 * bordered composer inside it that wears the console's accent. Never a third
 * box (an `<input>` with its own outline inside the composer).
 *
 * It is the positioning context, so a status badge pinned INSIDE the surface
 * costs no height on a widget at its `minSize`. Unlike `FramedDisplay` it takes
 * the remaining height; unlike `ScrollArea` it has a border and a positioning
 * context. It does not scroll: what goes inside scrolls itself.
 *
 * ## The standing reading sits at the FOOT, on the composer's TOP border
 *
 * `standing` is a readout of the LINK right now, drawn right-aligned over the
 * composer's top border, never over the scrollback's prose. It shares a column
 * with the queue's countdowns (the offset is the FOOT's inset, so the figures
 * line up exactly), and the two are never drawn together.
 *
 * `ComposerBar`'s own flag takes the LEFT end of the same border, since both
 * can be up at once: a terminal's separation and its refusal reveal on
 * different clocks. Neither knows about the other.
 *
 * With no composer there is no border to straddle, so the chip becomes an
 * ordinary right-aligned child at the foot, costing a band of height rather
 * than sitting over the prose.
 */
export type ConsoleTone = "accent" | "info";

export interface ConsoleFrameProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Which accent this console answers in: the primary accent for a terminal
   * that dispatches to a craft, the informational one for a message log. The
   * frame paints nothing with it; it declares `--console-tone-fg` once for the
   * composer's border, prompt glyph and focus ring.
   */
  tone?: ConsoleTone;
  /**
   * What is still crossing, at the foot and immediately above the composer.
   * A slot of its own, so the frame knows whether there is a composer.
   */
  queue?: ReactNode;
  /**
   * The line the operator types on, at the foot, inside the frame and inset
   * from its edges. Given but falsy keeps the foot, so a mode switch does not
   * change the surface's height.
   */
  composer?: ReactNode;
  /**
   * A standing reading of the link, drawn over the TOP border of the composer
   * and right-aligned to the queue's column of times. Out of flow while there
   * IS a composer; an ordinary child at the foot when there is not.
   */
  standing?: ReactNode;
  children?: ReactNode;
}

export function ConsoleFrame({
  tone = "accent",
  queue,
  composer,
  standing,
  children,
  ...rest
}: ConsoleFrameProps) {
  // Any of the three grows a foot, so a standing reading never hangs over the log.
  const hasFoot =
    queue !== undefined || composer !== undefined || standing !== undefined;
  // A falsy `composer` keeps the foot but has no border, so the chip goes back into flow.
  const straddles = standing !== undefined && Boolean(composer);
  return (
    // A stable structural hook, since containment is invisible to a role query.
    <ConsoleFrame__Box data-console-frame="" $tone={tone} {...rest}>
      <ConsoleFrame__Surface>{children}</ConsoleFrame__Surface>
      {hasFoot && (
        <ConsoleFrame__Foot $straddled={straddles}>
          {queue}
          {standing !== undefined && (
            /*
              A structural hook for the same reason. BEFORE the composer, so
              in the in-flow case the reading is announced before the control
              it sits above.
            */
            <ConsoleFrame__Standing
              data-console-standing=""
              $straddle={straddles}
            >
              {standing}
            </ConsoleFrame__Standing>
          )}
          {composer}
        </ConsoleFrame__Foot>
      )}
    </ConsoleFrame__Box>
  );
}

const ConsoleFrame__Box = styled.div<{ $tone: ConsoleTone }>`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  /* Subtle, not the tone: the accent belongs to the input's own border. */
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  overflow: hidden;

  ${({ $tone }) =>
    $tone === "info"
      ? css`
          --console-tone-fg: var(--color-info-text);
        `
      : css`
          --console-tone-fg: var(--color-accent-fg);
        `}
`;

// The scrollback half. `position: relative` is for the caller's own overlays; the frame pins nothing here.
const ConsoleFrame__Surface = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

/*
 * A row, so a second standing reading sits beside the first in reading order.
 * `right` is the FOOT's inset, putting the chip's right edge on the
 * composer's, which lines its figure up with the queue's countdowns. `top` is
 * the same token as the foot's padding-top, so no hand-computed offset drifts
 * when the font size changes on a coarse pointer. That assumes the composer is
 * the foot's first box, which holds because the chip and the queue are never
 * drawn together. `z-index: 1` is local sibling ordering.
 */
const ConsoleFrame__Standing = styled.div<{ $straddle: boolean }>`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--gap-console-readings);
  /* Overlaps the composer's corner with nothing to click, so it must not take a press. */
  pointer-events: none;

  ${({ $straddle }) =>
    $straddle
      ? css`
          position: absolute;
          right: var(--inset-console-foot);
          top: var(--inset-console-foot-straddled);
          transform: translateY(-50%);
          z-index: 1;
        `
      : // No border to straddle, so it takes a line of its own and keeps only the column.
        css`
          align-self: flex-end;
        `}
`;

/*
 * Non-growing, so a filling queue or an opening picker never takes height from
 * the scrollback. Its own positioning context, so a composer's dropdown anchors
 * inside the console and the standing reading pins against the foot. The
 * padding makes the composer read as a control IN the console. `$straddled`
 * deepens the top inset so the half-chip above the border never lands on the
 * log's last line.
 */
const ConsoleFrame__Foot = styled.div<{ $straddled: boolean }>`
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-console-foot);
  padding: var(--inset-console-foot);

  ${({ $straddled }) =>
    $straddled &&
    css`
      padding-top: var(--inset-console-foot-straddled);
    `}
`;
