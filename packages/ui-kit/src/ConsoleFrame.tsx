import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * A console: a scrolling surface that takes the remaining height of a panel
 * body, and, sitting INSIDE it at the foot, whatever the operator types into
 * it.
 *
 * ## The composer is inside, and keeps its own box
 *
 * The composer was OUTSIDE, in both widgets that have one, hanging off the
 * bottom edge as a box strapped to the console rather than a control in it.
 * That is the shape of no other widget in the app, and it is what `footer`
 * fixes: the input belongs in the widget's body.
 *
 * What `footer` deliberately does NOT do is absorb the composer into one big
 * outline. This frame's own border is SUBTLE, and the console's accent is worn
 * by the bordered composer sitting inside it. Wrapping both halves in one loud
 * outline with a rule across the middle was tried, and it read as a single
 * sealed console with a bottom section rather than as a widget containing an
 * input: "I don't want that border to go round the entire widget, it can stay
 * just around the input".
 *
 * So the nesting is exactly two deep and stops there: a quiet frame, and one
 * bordered input in it. A third box (an `<input>` with its own outline inside
 * the composer, which Commcast had) is the thing to keep out.
 *
 * ## The positioning context is half the point
 *
 * A widget's status badge rendered as a flex sibling above or below its main
 * surface adds its own row height to everything else in the body, and on a
 * widget at its declared `minSize` that pushes whatever sits beneath (the
 * composer, a queue) past the tile's visible bounds. A badge pinned INSIDE the
 * surface costs no height at all. A terminal-emulator widget discovered that
 * three times over and wrote the reasoning down three times, once per badge,
 * because there was no primitive whose job it was to hold it.
 *
 * Distinct from its two neighbours in this package, and not a third copy of
 * either:
 *
 *   - `FramedDisplay` frames a VISUAL and deliberately "does NOT scroll or
 *     size itself", because only its caller knows whether the diagram or the
 *     numbers beside it should win. A console pane is the opposite case: it is
 *     the widget's main surface, it always wins, and taking the remaining
 *     height is the behaviour rather than a decision to delegate.
 *   - `ScrollArea` owns height and nothing else: no border, no positioning.
 *
 * It does not scroll, and that is deliberate too: what goes inside is a
 * `ScrollArea`, a canvas, or a terminal emulator that scrolls itself. Owning
 * the scroll here would fight all three.
 *
 * ## The corner
 *
 * `corner` is the top-right slot, and it exists because the second real use
 * turned up. It was declined once, on the reasoning that only one of the two
 * consoles wanted a corner and an overlay over a column of prose sits on a
 * sentence the operator has to read, so the other put its standing delay
 * reading inside its composer instead. Both were defensible and the pair was
 * not: one console answered "how far away is the other end" over the
 * scrollback and the other answered it beside Send, and an operator moving
 * between them had to find the reading twice. The operator's call settled it,
 * and it is the frame's now rather than each widget's: "I like it in the top
 * right corner, please can we just align to that".
 *
 * What it costs on a prose console is the top-right of the topmost VISIBLE
 * line, which in a log that grows upward from the composer is the oldest thing
 * still on screen rather than the newest. That is the trade the ruling accepts.
 *
 * The other corners are still each widget's own. A character grid is the only
 * surface in the app with three spare, and a slot per corner guessed at from
 * one caller is the API this one was right to decline the first time.
 */
export type ConsoleTone = "accent" | "info";

export interface ConsoleFrameProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Which accent this console answers in.
   *
   * A PROP rather than a per-widget stylesheet, because the two consoles in the
   * app are the same components and differ only here: a terminal that dispatches
   * to a craft keeps the primary accent, a message log that carries words takes
   * the informational one. Both are theme tokens, so a theme moves them together
   * and neither widget owns a colour.
   *
   * The frame paints NOTHING with it. It declares it once, as
   * `--console-tone-fg`, and the things inside that wear the accent read it
   * from there: the composer's border, its prompt glyph, the focus ring on
   * whatever the caller types into. Declaring it here rather than on each of
   * them is what stops a console whose input is green from having a blue caret.
   */
  tone?: ConsoleTone;
  /**
   * Sitting at the foot, inside the frame and inset from its edges, non-growing:
   * the composer, and anything belonging immediately above it such as an
   * in-flight queue.
   *
   * A slot rather than a convention, so a caller cannot go back to strapping the
   * composer onto the outside of the console.
   */
  footer?: ReactNode;
  /**
   * A standing reading, pinned in the top-right of the scrollback: what is true
   * of the link right now rather than of any one thing said over it.
   *
   * Out of flow, so it costs the body no height. That is what makes it usable
   * on a widget at its declared `minSize`, where the same chip as a flex
   * sibling pushes the composer past the tile's visible bounds.
   *
   * Over the scrollback and never over the foot: an overlay belongs on what has
   * already been said, not on the line being typed.
   */
  corner?: ReactNode;
  children?: ReactNode;
}

export function ConsoleFrame({
  tone = "accent",
  footer,
  corner,
  children,
  ...rest
}: ConsoleFrameProps) {
  return (
    /* `data-console-frame`, the same kind of stable structural hook
       `ScrollArea` exposes as `data-scroll-area-inner`. It is what lets each
       console prove its OWN composer is inside it: the property this component
       exists for is invisible to a role query, because containment is not a
       role and both widgets rendered perfectly good composers while they hung
       underneath. */
    <ConsoleFrame__Box data-console-frame="" $tone={tone} {...rest}>
      <ConsoleFrame__Surface>
        {children}
        {corner !== undefined && (
          /* `data-console-corner`, the sibling of `data-console-frame` above
             and there for the same reason: WHERE a badge hangs is invisible to
             a role query, and both consoles rendered a perfectly good one
             while they hung it in two different places. */
          <ConsoleFrame__Corner data-console-corner="">
            {corner}
          </ConsoleFrame__Corner>
        )}
      </ConsoleFrame__Surface>
      {footer !== undefined && (
        <ConsoleFrame__Foot>{footer}</ConsoleFrame__Foot>
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
  /* SUBTLE, and deliberately not the tone. The accent belongs to the input,
     which wears it as its own border; a loud outline here would put a second
     one around something already bordered and seal the two halves into one
     console instead of a widget with a control in it. */
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;

  ${({ $tone }) =>
    $tone === "info"
      ? css`
          --console-tone-fg: var(--color-status-info-fg);
        `
      : css`
          --console-tone-fg: var(--color-accent-fg);
        `}
`;

/*
 * The scrollback half, and what a badge is pinned against: an overlay belongs
 * over what has already been said, never over the line being typed.
 */
const ConsoleFrame__Surface = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

/*
 * Non-growing, so a queue that fills or a picker that opens can never take
 * height from the scrollback above. A positioning context of its own, so a
 * composer's dropdown anchors inside the console rather than escaping the tile.
 *
 * The padding is what makes the composer read as a control sitting IN the
 * console rather than as its bottom section: an inset bordered box has a widget
 * around it, one flush to three edges is a region of the widget.
 */
/*
 * A row rather than a single box, so a console with a second standing reading
 * gets them side by side in reading order instead of one on top of the other.
 *
 * `z-index: 1` is local sibling ordering inside this frame's own stacking
 * context: it lifts the chip over whatever the scrollback mounts, which for a
 * terminal emulator is a stack of its own layers. Not app-global chrome, so no
 * named z rung.
 */
const ConsoleFrame__Corner = styled.div`
  position: absolute;
  top: var(--space-8);
  right: var(--space-8);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-6);
`;

const ConsoleFrame__Foot = styled.div`
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8);
`;
