import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styled from "styled-components";

/**
 * A bordered pane that takes the remaining height of a panel body, and gives
 * whatever is pinned inside it something to be pinned against.
 *
 * The positioning context is half the point. A widget's status badge rendered
 * as a flex sibling above or below its main surface adds its own row height to
 * everything else in the body, and on a widget at its declared `minSize` that
 * pushes whatever sits beneath (a composer, a queue) past the tile's visible
 * bounds. A badge pinned INSIDE the pane costs no height at all. A
 * terminal-emulator widget discovered that three times over and wrote the
 * reasoning down three times, once per badge, because there was no primitive
 * whose job it was to hold it.
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
export interface ConsoleFrameProps extends ComponentPropsWithoutRef<"div"> {
  children?: ReactNode;
}

export function ConsoleFrame({ children, ...rest }: ConsoleFrameProps) {
  return <ConsoleFrame__Box {...rest}>{children}</ConsoleFrame__Box>;
}

const ConsoleFrame__Box = styled.div`
  /* The reason a caller can pin a badge inside instead of stacking it above. */
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
`;
