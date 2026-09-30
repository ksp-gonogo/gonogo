import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  InFlightList,
  type InFlightListItem,
  signalDelayPresentation,
} from "./CommandDelay/InFlightList";
import { SignalDelayBadge } from "./CommandDelay/SignalDelayBadge";
import { ConsoleFrame, type ConsoleTone } from "./ConsoleFrame";

export type { ConsoleTone };

/**
 * Props for {@link Console}. Any other `div` attribute is passed to the frame.
 *
 * @category Console
 */
export interface ConsoleProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Which accent this console is drawn in, declared once for the composer's
   * border, prompt glyph and focus ring.
   */
  tone?: ConsoleTone;
  /**
   * How long it takes to reach the other end, in seconds. `null` when there is
   * no measurable path. Neither `null` nor zero gets a chip.
   */
  oneWaySeconds?: number | null;
  /**
   * The same delay as the reading it arrived in (`useCommand`'s
   * `delayReading`), so the chip's figure draws held while `comms.delay` is
   * quiet. Omitted, it draws as current.
   */
  delayReading?: Reading<Value<"s">> | null;
  /**
   * Whether anything this console sends can sit in a queue. A read-only viewer
   * passes `false` and gets NEITHER reading at a long delay.
   */
  canQueue?: boolean;
  /**
   * Force the chip whatever the separation, for a terminal in CHARACTER mode,
   * which has no composed line to queue.
   */
  alwaysBadge?: boolean;
  /**
   * What is still crossing, one entry per thing out. Drawn between the
   * scrollback and the composer, never inside the scroll.
   */
  inFlight?: InFlightListItem[];
  /**
   * The entries carry their OWN separation, frozen when sent, so the queue
   * outlives the live reading: words sent at four light-minutes are still out
   * there after the path drops. The chip and the queue are still never drawn
   * together.
   */
  inFlightFrozenAtDispatch?: boolean;
  /**
   * The line the operator types on, at the foot and inside the frame. Omitted,
   * the console grows no foot. Given but currently absent (a terminal in
   * character mode), the foot stays, so the surface does not change height
   * with the mode. A standing chip grows a foot for itself either way.
   */
  composer?: ReactNode;
  /** The scrollback: an emulator screen, a log, a list of rows. */
  children?: ReactNode;
}

/** Every console's queue name; not a prop, so an operator never hears two. */
const QUEUE_LABEL = "Uplink queue";

/**
 * A console: a scrolling surface, what is still crossing on the link, the line
 * the operator is typing, and one reading of how far away the other end is.
 *
 * The delay reading is chosen here, not by the widget: a standing
 * {@link SignalDelayBadge} when the other end is close enough that a countdown
 * would be over before it could be read, an {@link InFlightList} queue of what
 * is crossing when it is not, never both. Both sit at the foot. A widget says
 * only how far away the other end is (`oneWaySeconds`), whether it can queue
 * (`canQueue`) and what is queued (`inFlight`).
 *
 * The composer (usually a {@link ComposerBar}) and the scrollback are the
 * widget's; this places them and draws the frame around them.
 *
 * @category Console
 */
export function Console({
  tone,
  oneWaySeconds = null,
  delayReading,
  canQueue = true,
  alwaysBadge = false,
  inFlight,
  inFlightFrozenAtDispatch = false,
  composer,
  children,
  ...rest
}: ConsoleProps) {
  const presentation = signalDelayPresentation({
    oneWaySeconds,
    canQueue,
    alwaysBadge,
  });
  // "badge" implies a non-null separation, which the type cannot carry back here.
  const badgeSeconds = presentation === "badge" ? oneWaySeconds : null;
  const showStrip =
    inFlight !== undefined &&
    (presentation === "strip" ||
      (inFlightFrozenAtDispatch && presentation !== "badge"));
  return (
    // Two slots rather than one `footer`, so the frame knows whether there is a composer to place the reading against.
    <ConsoleFrame
      {...(tone !== undefined ? { tone } : {})}
      {...(badgeSeconds !== null
        ? {
            standing: (
              <SignalDelayBadge
                oneWaySeconds={badgeSeconds}
                delayReading={delayReading}
              />
            ),
          }
        : {})}
      {...(showStrip
        ? { queue: <InFlightList items={inFlight} ariaLabel={QUEUE_LABEL} /> }
        : {})}
      {...(composer !== undefined ? { composer } : {})}
      {...rest}
    >
      {children}
    </ConsoleFrame>
  );
}
