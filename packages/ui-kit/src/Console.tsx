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
 * A console: a scrolling surface, what is still crossing on the link, the line
 * the operator is typing, and one reading of how far away the other end is.
 *
 * Composes the way `Panel` composes its parts, and for the same reason. The
 * pieces were all published and the COMPOSITION was not, so the two consoles in
 * this repo each assembled it out of six imports and a delay decision, twice.
 * Assembled twice is drifted twice: one hung the delay chip over its scrollback
 * and the other beside Send, one bordered its own input and the other did not,
 * and each defect had to be found and fixed in two places. A widget now says it
 * IS a console and gets the house treatment.
 *
 * ## The delay reading is this component's decision, not the widget's
 *
 * A console has two ways to say what the delay costs and they are mutually
 * exclusive: a standing chip when the other end is close enough that a
 * countdown would be over before it could be read, and a queue of what is
 * actually crossing when it is not. Drawn together they say the same number
 * twice in two shapes.
 *
 * Both are drawn at the FOOT, in one column, because they are the same kind of
 * value: seconds until something happens. The chip spent three days in the
 * top-right of the scrollback, diagonally opposite the queue and on top of the
 * prose, where neither could be read against the other.
 *
 * So a widget does not choose between them. It says how far away the other end
 * is (`oneWaySeconds`), whether it can put anything in a queue (`canQueue`),
 * and what is in that queue (`inFlight`); which of the two gets drawn is
 * decided here, once. Both widgets used to make that call themselves and one of
 * them then had to keep a second local narrowing in step with it.
 *
 * ## What is still the widget's
 *
 * The composer, because the three that exist are a terminal's character-pitched
 * caret line, a message input and a recipient picker, and nothing useful is
 * shared past the bordered row `ComposerBar` already is. The scrollback, for the
 * same reason: an xterm canvas and a column of prose have no common shape.
 *
 * This owns where those go and what is drawn around them, which is exactly the
 * part that was drifting.
 */
export interface ConsoleProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Which accent this console answers in. Passed through to the frame, which
   * declares it once for the composer's border, its prompt glyph and its focus
   * ring, so a console whose input is green cannot have a blue caret.
   */
  tone?: ConsoleTone;
  /**
   * How long it takes to reach the other end, in seconds. `null` when there is
   * no measurable path, which is a different reading from a measured zero and
   * gets no chip either way.
   */
  oneWaySeconds?: number | null;
  /**
   * Whether anything this console sends can sit in a queue. A read-only viewer
   * passes `false` and gets NEITHER reading at a long delay: there is nothing to
   * list, and a standing chip would quote a cost it never pays.
   */
  canQueue?: boolean;
  /**
   * Force the chip whatever the separation. A terminal emulator in CHARACTER
   * mode sets this: every keystroke goes on its own, so there is no composed
   * line for a queue to list however far away the craft is.
   */
  alwaysBadge?: boolean;
  /**
   * What is still crossing, one entry per thing out. Drawn between the
   * scrollback and the composer, never inside the scroll, where it would take
   * the bottom of the log as it grows.
   */
  inFlight?: InFlightListItem[];
  /**
   * The entries carry their OWN separation, frozen when they were sent, rather
   * than being derived from the live link.
   *
   * The one place the two consoles genuinely differ, and it is about the QUEUE
   * rather than about the console. Words put out at four light-minutes are
   * still four light-minutes out after the path drops, and the queue is the
   * only place they appear, so it has to outlive the live reading the chip is
   * drawn from. A queue derived from the live route has nothing to lose when
   * that reading goes and stays gated on it.
   *
   * Either way the chip and the queue are never drawn together, which is the
   * property the operator asked for.
   */
  inFlightFrozenAtDispatch?: boolean;
  /**
   * The line the operator types on, at the foot and inside the frame.
   *
   * Omitted entirely, the console grows no foot at all: an inbox is a list of
   * conversations and there is nothing to type at it. Given but currently
   * absent (a terminal in character mode, which composes nothing), the foot
   * stays, so the surface above it does not change height when the mode does.
   *
   * Either way a standing chip still grows a foot for itself, because the only
   * other place to put it is over the log. A composer-less console pays a band
   * of height for the reading; see the frame's placement section.
   */
  composer?: ReactNode;
  /** The scrollback: an emulator screen, a log, a list of rows. */
  children?: ReactNode;
}

/**
 * Both consoles name their queue this. It is not a prop, because a name each
 * caller picks is a name that comes out different on each console, and an
 * operator moving between them would hear two.
 */
const QUEUE_LABEL = "Uplink queue";

export function Console({
  tone,
  oneWaySeconds = null,
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
  /*
   * Narrowed to a non-null local rather than read inline: "badge" implies a
   * separation, because a null one returns "none", but that is a fact about the
   * function rather than something the type carries back to the read site.
   */
  const badgeSeconds = presentation === "badge" ? oneWaySeconds : null;
  const showStrip =
    inFlight !== undefined &&
    (presentation === "strip" ||
      (inFlightFrozenAtDispatch && presentation !== "badge"));
  return (
    /* The queue and the composer go in as two slots rather than as one `footer`
       node. The frame places the standing reading against the composer's border
       specifically, and a frame handed one opaque child cannot tell whether
       there is a composer in it, so it would have to take the caller's word. */
    <ConsoleFrame
      {...(tone !== undefined ? { tone } : {})}
      {...(badgeSeconds !== null
        ? { standing: <SignalDelayBadge oneWaySeconds={badgeSeconds} /> }
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
