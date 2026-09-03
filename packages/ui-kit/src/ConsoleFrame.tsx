import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * A bordered console: a scrolling surface that takes the remaining height of a
 * panel body, and, pinned at its foot INSIDE the same border, whatever the
 * operator types into it.
 *
 * ## The composer is inside
 *
 * It was outside, in both widgets that have one, and the border then contained
 * different things in each: a terminal screen in one, a column of messages in
 * the other, with the input hanging underneath as a separate box. Two consoles
 * meant to read as siblings looked unrelated, and an input bar sitting outside
 * its own panel does not look like any other widget in the app.
 *
 * So `footer` is a slot rather than a convention. A caller cannot put the
 * composer above the frame by accident, and the outline contains the same two
 * things in every console: what has been said, and where you say the next
 * thing.
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
 * It offers no corner SLOTS. That was tried and taken back out: the two
 * widgets that share this frame turned out to want opposite things in a
 * corner, and only one of them wanted a corner at all. An overlay works on a
 * character grid whose top corner is usually empty cells; over a column of
 * prose it sits on top of a sentence the operator has to read, and the reading
 * it carried there belonged on the control it was the cost of. So the pinning
 * stays with the widget that has something to pin, and a corner API waits for
 * a second real use rather than being guessed at from one.
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
   * It reaches the foot as `--console-tone-fg`, which is how `ComposerBar`'s
   * rule and a caller's own prompt glyph come out in the same tone without
   * either being told separately.
   */
  tone?: ConsoleTone;
  /**
   * Input is not being accepted, so the WHOLE console takes the error tone
   * rather than a chip in one corner of it.
   *
   * Both consoles refuse input at the input-acceptance step when there is no
   * comms path, before anything is cleared or dispatched, and a refusal the
   * operator only learns about by pressing the key is a refusal they read as a
   * bug. Toning the border says it on sight, while they are still typing.
   */
  blocked?: boolean;
  /**
   * Pinned at the foot, inside the border, and non-growing: the composer, and
   * anything belonging immediately above it such as an in-flight queue.
   */
  footer?: ReactNode;
  children?: ReactNode;
}

export function ConsoleFrame({
  tone = "accent",
  blocked = false,
  footer,
  children,
  ...rest
}: ConsoleFrameProps) {
  return (
    /* `data-console-frame`, the same kind of stable structural hook
       `ScrollArea` exposes as `data-scroll-area-inner`. It is what lets each
       console prove its OWN composer is inside its own border: the property
       this component exists for is invisible to a role query, because the
       border is not a role and both widgets rendered perfectly good composers
       while they hung outside it. */
    <ConsoleFrame__Box
      data-console-frame=""
      $tone={tone}
      $blocked={blocked}
      {...rest}
    >
      <ConsoleFrame__Surface>{children}</ConsoleFrame__Surface>
      {footer !== undefined && (
        <ConsoleFrame__Foot>{footer}</ConsoleFrame__Foot>
      )}
    </ConsoleFrame__Box>
  );
}

const ConsoleFrame__Box = styled.div<{
  $tone: ConsoleTone;
  $blocked: boolean;
}>`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  border: 1px solid var(--console-tone-fg);
  border-radius: var(--radius-md);
  overflow: hidden;

  ${({ $tone, $blocked }) =>
    $blocked
      ? css`
          --console-tone-fg: var(--color-status-nogo-fg);
        `
      : $tone === "info"
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
 */
const ConsoleFrame__Foot = styled.div`
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;
