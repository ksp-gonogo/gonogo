import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * The BOX a console is drawn in: a scrolling surface that takes the remaining
 * height of a panel body, and, sitting INSIDE it at the foot, whatever the
 * operator types into it.
 *
 * Reached through `Console` and not exported bare, the same rule `Panel`
 * follows for its own parts. What a widget wants is the whole arrangement, and
 * two widgets assembling it out of this plus a queue plus a chip is how they
 * came to hang the same reading in two different corners.
 *
 * ## The composer is inside, and keeps its own box
 *
 * The composer was OUTSIDE, in both widgets that have one, hanging off the
 * bottom edge as a box strapped to the console rather than a control in it.
 * That is the shape of no other widget in the app, and it is what the `composer`
 * slot fixes: the input belongs in the widget's body.
 *
 * What that slot deliberately does NOT do is absorb the composer into one big
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
 * ## The standing reading sits at the FOOT, on the composer's TOP border
 *
 * `standing` is a readout of what is true of the LINK right now rather than of
 * any one thing said over it, and this frame draws it over the top border of
 * the composer, right-aligned: between the scrollback and the line the operator
 * types on.
 *
 * It hung in the top-right of the scrollback for three days and the objection
 * that had been raised against putting it there was the one that came true: a
 * scrollback is a column of prose, and an overlay pinned over it sits on a
 * sentence somebody has to read. "I don't think it can stay in that top
 * corner."
 *
 * The foot is where it belongs because of what the reading IS. The queue above
 * the composer is a list of seconds-until-something-happens, and the standing
 * delay is the same kind of value; in opposite corners they could not be
 * compared at a glance, and in one column they read as one stack of times. The
 * two are never drawn TOGETHER (the badge/strip decision is exclusive), so the
 * alignment is about them occupying the same column across two states rather
 * than the same row in one moment.
 *
 * The column comes out exact rather than approximately: the chip and the queue
 * box carry the same border and the same horizontal padding, so pinning the
 * chip flush to the composer's right edge lands its figure in the same x as a
 * countdown's. That is why the offset below is the FOOT's inset and not the
 * composer's own, which would be a chip's padding narrower.
 *
 * TOP rather than bottom because the reading belongs on the side of the
 * composer the operator's eye is already crossing: "the trip time badge should
 * sit above the composer, not below". The bottom border put it under the last
 * control on the widget, where it read as a footnote to the send button rather
 * than as a property of the link the queue above it is counting down on. On the
 * top border it lands where the queue's own last row would be, which is the
 * whole point of the shared column.
 *
 * ## The composer's own flag holds the OTHER end of that border
 *
 * `ComposerBar` pins a short flag ("NO PATH") on the same top border, and the
 * two CAN be up at once.
 *
 * Not on the message console: there the flag is shown exactly when the
 * separation is null, one expression off one source, and a null separation gets
 * no chip. The terminal is the one that can show both, because its refusal and
 * its separation come off two topics that reveal on different clocks:
 * `comms.delay` is TrueNow, `comms.link` is Delayed (freeze-exempt), so on a
 * link coming BACK the separation is measurable again a light-time before the
 * refusal clears. Bounded by the separation itself, so at the sub-second ones
 * that get a chip the window is under a second; a one-frame skew between the
 * two deliveries opens the same gap for a frame.
 *
 * They take opposite ENDS of the border rather than being stacked or made
 * exclusive: the chip keeps the right, because its column is shared with the
 * queue and is the thing that must not move, and the flag takes the left, where
 * it sits over the prompt glyph and reads as a label on the row it is refusing
 * for. Neither knows about the other, which is what stops a fix here from
 * needing one there.
 *
 * ## With no composer there is no border to straddle
 *
 * The straddle is out of flow and costs the body nothing, which is what makes
 * it usable on a widget at its declared `minSize`. It needs an edge, though,
 * and a console can have none: `composer` omitted is an inbox, a list of
 * conversations with nothing to type at.
 *
 * So with no composer the chip stops being an overlay and becomes an ordinary
 * right-aligned child at the foot, growing a foot if there was not one. That
 * costs a band of height. It is the trade this placement accepts, because the
 * alternative puts the chip back over the prose in exactly the state where the
 * console is nothing BUT prose.
 *
 * The other corners of the SURFACE are still each widget's own. A character
 * grid is the only one in the app with any spare, and a slot per corner guessed
 * at from one caller is the API this frame was right to decline.
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
   * What is still crossing, at the foot and immediately above the composer.
   *
   * Its own slot rather than part of one `footer` node, which is what the two
   * of them used to arrive in. The standing reading below is placed against the
   * composer specifically, and a frame handed one opaque child would have to
   * take the caller's word for whether there is a composer in it.
   */
  queue?: ReactNode;
  /**
   * The line the operator types on, at the foot, inside the frame and inset
   * from its edges.
   *
   * A slot rather than a convention, so a caller cannot go back to strapping the
   * composer onto the outside of the console.
   *
   * Given but falsy keeps the foot, so a console whose composer comes and goes
   * with a mode does not change the height of the surface above it when it does.
   */
  composer?: ReactNode;
  /**
   * A standing reading of the link, drawn over the TOP border of the composer
   * and right-aligned to the queue's column of times.
   *
   * Out of flow while there IS a composer, so it costs the body no height; an
   * ordinary right-aligned child at the foot when there is not, since then
   * there is no border to straddle. See the placement section above for why the
   * foot rather than the scrollback it used to hang over.
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
  /*
   * The foot exists for any of the three, so a console with only a standing
   * reading still grows one to put it in rather than hanging it over the log.
   */
  const hasFoot =
    queue !== undefined || composer !== undefined || standing !== undefined;
  /* Falsy `composer` is the mode-switched case: the foot stays, the border does
     not, and a chip with no border to sit on goes back into flow. */
  const straddles = standing !== undefined && Boolean(composer);
  return (
    /* `data-console-frame`, the same kind of stable structural hook
       `ScrollArea` exposes as `data-scroll-area-inner`. It is what lets each
       console prove its OWN composer is inside it: the property this component
       exists for is invisible to a role query, because containment is not a
       role and both widgets rendered perfectly good composers while they hung
       underneath. */
    <ConsoleFrame__Box data-console-frame="" $tone={tone} {...rest}>
      <ConsoleFrame__Surface>{children}</ConsoleFrame__Surface>
      {hasFoot && (
        <ConsoleFrame__Foot $straddled={straddles}>
          {queue}
          {standing !== undefined && (
            /* `data-console-standing`, the sibling of `data-console-frame`
               above and there for the same reason: WHERE a reading hangs is
               invisible to a role query, and both consoles rendered a perfectly
               good one while they hung it in two different places.

               BEFORE the composer, matching where it is drawn. Nothing about
               the straddle needs it (it is out of flow either way), but the
               falsy-composer case puts it in flow at this exact spot, and a
               reading announced after the control it sits above is a reading
               read out in the wrong order. */
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
 * The scrollback half. `position: relative` is for the CALLER's overlays, not
 * for anything this frame pins: a character grid has spare corners and puts its
 * own no-path badge in one, and those stay the widget's. Nothing of the
 * frame's own hangs here, which is the change that took the delay reading off
 * the prose it was sitting on.
 */
const ConsoleFrame__Surface = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

/*
 * A row rather than a single box, so a console with a second standing reading
 * gets them side by side in reading order instead of one on top of the other.
 *
 * `right: var(--space-8)` is the FOOT's own inset, which puts the chip's right
 * edge on the composer's, not `space-8` in from it. That is what lines the
 * figure up with a countdown in the queue: the chip and the queue box carry the
 * same border and the same horizontal padding, so equal outer edges mean equal
 * inner ones.
 *
 * `top` is the foot's padding-top, so the chip's own top edge lands on the
 * composer's top border and the translate centres it there. The pair reads the
 * SAME token as the padding below deliberately: a hand-computed offset here
 * would have to be recomputed whenever the chip's font size moved, and it does
 * move, the xs token grows on a coarse pointer.
 *
 * That offset assumes the composer is the first BOX in the foot, which holds
 * because the straddle needs a composer and the only other thing the foot ever
 * draws above one is the queue: `Console` picks the chip or the queue, never
 * both, and this frame is reached through `Console` alone.
 *
 * `z-index: 1` is local sibling ordering inside this frame's own stacking
 * context: it lifts the chip over whatever else the foot draws. Not app-global
 * chrome, so no named z rung.
 */
const ConsoleFrame__Standing = styled.div<{ $straddle: boolean }>`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  /* It overlaps the composer's top-right corner, the same border the row's own
     flag straddles at the far end. A readout must not take a press meant for
     the control underneath it: there is nothing here to click. */
  pointer-events: none;

  ${({ $straddle }) =>
    $straddle
      ? css`
          position: absolute;
          right: var(--space-8);
          top: var(--space-16);
          transform: translateY(-50%);
          z-index: 1;
        `
      : /* No border to straddle, so it takes a line of its own at the foot and
           keeps only the column. */
        css`
          align-self: flex-end;
        `}
`;

/*
 * Non-growing, so a queue that fills or a picker that opens can never take
 * height from the scrollback above. A positioning context of its own, so a
 * composer's dropdown anchors inside the console rather than escaping the tile,
 * and so the standing reading above pins against the foot rather than the frame.
 *
 * The padding is what makes the composer read as a control sitting IN the
 * console rather than as its bottom section: an inset bordered box has a widget
 * around it, one flush to three edges is a region of the widget.
 *
 * `$straddled` deepens the TOP inset to hold the half-chip that hangs above the
 * composer's border. Without it that half reaches back over the bottom of the
 * scrollback, which is the defect this reading was moved off the prose to fix
 * in the first place: the base inset is a chip's padding shy of its half-height
 * and the difference would land on the last line of the log.
 */
const ConsoleFrame__Foot = styled.div<{ $straddled: boolean }>`
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8);

  ${({ $straddled }) =>
    $straddled &&
    css`
      padding-top: var(--space-16);
    `}
`;
