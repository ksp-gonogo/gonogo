import { useState } from "react";
import styled, { css } from "styled-components";
import { CommandDelay } from "./CommandDelay";
import { CommandFoundList, type RailFound } from "./CommandFoundList";
import { CommandLossList, type RailLoss } from "./CommandLossList";
import { CommandRefusalList, type RailRefusal } from "./CommandRefusalList";
import {
  CommandUndeliveredList,
  type RailUndelivered,
} from "./CommandUndeliveredList";
import {
  type CommandHandle,
  useActiveCrossings,
  useActiveHandles,
} from "./DelayRailContext";
import { RailCrossing } from "./RailCrossing";

/**
 * Whether a handle's `CommandDelay` would draw anything: a stream with real
 * delay, or a discrete handle with in-flight rows. Mirrors `CommandDelay`'s own
 * null-decision so the rail shows a handle iff its `CommandDelay` renders. An
 * instant / idle command (a meta-vantage or not-yet-dispatched handle) is still
 * registered, so its must-consume token is marked and it appears the instant it
 * goes in flight, but it contributes no rail chrome meanwhile.
 *
 * A stream handle also needs BUFFERS, not just delay. `ControlDelayStream`
 * returns null on an empty `streams` array, so a stream-shaped command whose
 * delay UX is drawn elsewhere (the Navball's trim command shares
 * `vessel.control.setAxes` with the axes, but has no readback channel to build
 * a strip from) would otherwise mount the rail permanently to draw nothing
 * inside it, an empty band on every delayed link.
 */
function handleHasContent(handle: CommandHandle): boolean {
  if (handle.shape === "stream") {
    return (
      handle.effectiveDelaySeconds > 0 && (handle.streams?.length ?? 0) > 0
    );
  }
  return handle.inFlight.length > 0;
}

/**
 * The Panel-owned signal-delay rail. Reads the active command handles from the
 * nearest `DelayRailContext` (populated by `usePanelDelay` in the widget) and
 * renders each handle's delay UI through `CommandDelay`. Takes no prop: it is
 * context-collecting, so a command widget passes nothing.
 *
 * **The band is RESERVED, not taken.** `PanelContainer` carries a top-only
 * inset sized for this rail, on every panel, whether or not that panel has a
 * command to show; the rail is the container's first child and pulls itself up
 * into that inset. So a command going up costs the widget nothing: the strip
 * the rail draws in was already there and stays there when the last command
 * clears. That is what makes the v3 brief's requirement satisfiable rather than
 * self-contradictory. Two earlier shapes tried to conjure the space instead,
 * one by pushing the title down whenever a rail appeared and one by drawing
 * over the sticky header and taking its clicks, and both were the same mistake:
 * the space the rail needs is a property of the widget, not of the traffic.
 *
 * Collapsed, the rail is that strip in NORMAL FLOW inside the band (grazing
 * glows for discrete commands, a mini sparkline for a stream); with several
 * commands in flight their summaries overlay in that one band. It covers
 * nothing and moves nothing.
 *
 * Activating it (click / Enter / Space, native `<button>`; Esc collapses) PINS
 * it, and pinning GROWS the rail beyond the band: each command switches to its
 * fuller `expanded` view (the discrete list, the full-height stream graph with
 * its labels back), and because the rail is the container's first child, every
 * pixel it grows by pushes the Panel title and body DOWN. Content sliding is
 * the price of OPENING the rail, and it is only ever charged then.
 * `aria-pressed` / `aria-expanded` carry the state. Activating it AGAIN
 * (click / Enter / Space / Esc) un-pins and re-minifies it: pin is a true
 * toggle, not a one-way expand, and the pinned rail shows a small "▲"
 * hint so that's discoverable, not just present in the aria-label (which
 * carries the word "collapse" for assistive tech; the visible hint stays
 * icon-only). Hover separately grows it as a transient preview, gone on
 * pointer-leave and a no-op once pinned; an explicit un-pin click wins over a
 * pointer that simply hasn't moved off the rail yet, see
 * `suppressHoverPreview` below.
 *
 * Renders the band EMPTY when no active handle has anything to draw, so a
 * widget whose commands are all instant or idle gets the reserved strip and no
 * rail chrome inside it. "Anything to draw" is
 * five things, not one: something in flight, something the game refused,
 * something nothing ever answered, something that answered after it was called
 * lost, and something that never left this machine. The last four are terminal
 * and so have nothing in flight by definition, which is precisely why they are
 * asked for separately.
 */
export function PanelDelayRail() {
  const handles = useActiveHandles();
  const crossings = useActiveCrossings();
  const visible = handles.filter(handleHasContent);
  // Refusals come from EVERY registered handle, not just the ones with delay
  // content: a refused command has nothing in flight by definition (it settled),
  // so gating on `handleHasContent` would hide exactly the case this exists for.
  // Each carries its handle's shape, which decides glyph-tile vs. text label.
  const refusals: RailRefusal[] = handles.flatMap((h) =>
    (h.refusals ?? []).map((r) => ({ ...r, shape: h.shape })),
  );
  /*
   * Same rule, and the case for it is stronger: a comms-loss drop is refused a
   * queue entry BEFORE dispatch, so `handleHasContent` is false for the whole
   * of the command's life and the rail rendered nothing at all.
   */
  const losses: RailLoss[] = handles.flatMap((h) =>
    (h.losses ?? []).map((l) => ({ ...l, shape: h.shape })),
  );
  /*
   * Same rule again, and counted apart from the two above rather than with
   * them. A found is not a dead dispatch: it is a dispatch that turned out to be
   * alive, so folding it into "N commands failed" would put the one outcome that
   * reverses a failure inside the failure count.
   */
  const founds: RailFound[] = handles.flatMap((h) =>
    (h.founds ?? []).map((f) => ({ ...f, shape: h.shape })),
  );
  /*
   * Counted WITH the failures rather than apart from them, which is the
   * opposite call from the founds above and the same reasoning. An undelivered
   * command is a loss whose doubt resolved the bad way: it did not run, and it
   * now provably never will, so leaving it out would drop the collapsed count
   * at the moment the news got worse.
   */
  const undelivered: RailUndelivered[] = handles.flatMap((h) =>
    (h.undelivered ?? []).map((u) => ({ ...u, shape: h.shape })),
  );
  const deadCount = refusals.length + losses.length + undelivered.length;
  const hasContent =
    visible.length > 0 ||
    deadCount > 0 ||
    founds.length > 0 ||
    crossings.length > 0;
  const [pinned, setPinned] = useState(false);
  /**
   * The transient hover preview, held in React rather than left to a CSS
   * `:hover` rule, so that one flag decides both the rail's height and WHICH
   * view each command draws. Under the old CSS rule the box grew on hover while
   * its contents stayed the collapsed strip, which is a preview of nothing.
   */
  const [previewing, setPreviewing] = useState(false);
  // Suppresses the hover-preview immediately after an explicit un-pin
  // click made while the pointer is still over the rail, the common case
  // (the pointer is right there because the operator just clicked it). Without
  // this, the hover alone keeps forcing the grown layout, so the click's
  // un-pin is invisible until the pointer happens to leave, reading as "there
  // is no way to collapse it back".
  //
  // Cleared on the pointer's next genuine ENTRY, not its exit: collapsing the
  // rail out from under a stationary pointer changes the hover match
  // (browsers re-run hit-testing after layout) WITHOUT dispatching a real
  // `mouseleave` DOM event, real leave/enter events only fire on actual
  // pointer movement, so a leave-triggered clear can be silently skipped when
  // the click lands beyond the collapsed strip's shorter bounds. A fresh
  // `mouseenter`, by contrast, is spec-guaranteed on real re-entry, so it is
  // the reliable place to lift the suppression for the next hover.
  const [suppressHoverPreview, setSuppressHoverPreview] = useState(false);
  const grown = pinned || (previewing && !suppressHoverPreview);

  /*
   * There is no measured height to publish and nothing to observe. The rail is
   * the panel container's first child, drawing inside the container's own top
   * band, so growing it pushes the glow, the header and the body down by
   * ordinary flow. The `--panel-rail-height` variable, the `ResizeObserver`
   * that fed it and the `PanelRailTarget` context that carried the element it
   * was written onto were all machinery for a rail living INSIDE the scroller
   * it had to move, and none of them survive the move out of it.
   */

  // Stream(s) on top, discrete underneath (operator's v3 ordering): a stable
  // partition, streams keep their order, discrete keep theirs.
  const ordered = [
    ...visible.filter((h) => h.shape === "stream"),
    ...visible.filter((h) => h.shape !== "stream"),
  ];

  // Route a dismiss to the handle that owns the refusal, the same way
  // `CommandDelay` routes an in-flight dismiss. Absent when no handle can
  // dismiss, so the boxes carry no clear control rather than an inert one.
  const canDismissRefusal = handles.some(
    (h) => h.dismiss && (h.refusals?.length ?? 0) > 0,
  );
  const dismissRefusal = canDismissRefusal
    ? (id: string) =>
        handles.find((h) => h.refusals?.some((r) => r.id === id))?.dismiss?.(id)
    : undefined;
  const canDismissLoss = handles.some(
    (h) => h.dismiss && (h.losses?.length ?? 0) > 0,
  );
  const dismissLoss = canDismissLoss
    ? (id: string) =>
        handles.find((h) => h.losses?.some((l) => l.id === id))?.dismiss?.(id)
    : undefined;
  const canDismissUndelivered = handles.some(
    (h) => h.dismiss && (h.undelivered?.length ?? 0) > 0,
  );
  const dismissUndelivered = canDismissUndelivered
    ? (id: string) =>
        handles
          .find((h) => h.undelivered?.some((u) => u.id === id))
          ?.dismiss?.(id)
    : undefined;
  const canDismissFound = handles.some(
    (h) => h.dismiss && (h.founds?.length ?? 0) > 0,
  );
  const dismissFound = canDismissFound
    ? (id: string) =>
        handles.find((h) => h.founds?.some((f) => f.id === id))?.dismiss?.(id)
    : undefined;

  return (
    /* An EMPTY band carries no state attributes, only the band's own marker.
       Every widget in the app renders this element whether it commands anything
       or not, so a state flag on an empty strip would be noise on every widget's
       DOM and in every snapshot of one, describing a control that is not there. */
    <PanelDelayRail__Frame data-panel-rail-frame="">
      {/* Nothing to draw leaves the band standing EMPTY, which is the whole
          point: the strip is the panel's, not the traffic's, so a widget with
          no command in flight looks the same as one waiting on an ack. */}
      {!hasContent ? null : (
        <PanelDelayRail__Rail
          type="button"
          data-panel-rail=""
          data-grown={grown}
          data-pinned={pinned}
          data-suppress-hover={suppressHoverPreview}
          aria-pressed={pinned}
          aria-expanded={grown}
          aria-label={
            pinned
              ? "Signal-delay detail; activate to collapse"
              : "Signal-delay detail; activate to expand it in place"
          }
          onClick={() => {
            setPinned((p) => {
              const next = !p;
              if (!next) setSuppressHoverPreview(true);
              return next;
            });
          }}
          onMouseEnter={() => {
            setSuppressHoverPreview(false);
            setPreviewing(true);
          }}
          onMouseLeave={() => setPreviewing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && pinned) {
              e.stopPropagation();
              setPinned(false);
              /* Same escape hatch as the un-pin click: a pointer resting on
                 the rail while the operator reaches for Escape would otherwise
                 hold the preview open and swallow the collapse. */
              setSuppressHoverPreview(true);
            }
          }}
        >
          {grown && (
            <PanelDelayRail__CollapseHint aria-hidden="true">
              ▲
            </PanelDelayRail__CollapseHint>
          )}
          {ordered.map((h) => (
            <CommandDelay
              key={h.id}
              handle={h}
              variant={grown ? "expanded" : "rail"}
              ariaLabel={grown ? "Delay detail" : undefined}
            />
          ))}
          {/* Tagged crossings share the band with the commands, the same way two
            commands do: every rail child sits in the one grid cell collapsed,
            and stacks when the rail grows. */}
          {crossings.map((c) => (
            <RailCrossing
              key={c.id}
              tags={c.tags}
              label={c.label}
              amplitudes={c.amplitudes}
              spanSamples={c.spanSamples}
              progress={c.progress}
              variant={grown ? "expanded" : "rail"}
            />
          ))}
          {!grown && (deadCount > 0 || founds.length > 0) && (
            /* One end-aligned run holding both counts. They are separate
             sentences in separate colours, but they share the band's single
             grid cell, so laying them out apart would stack one over the
             other. */
            <PanelDelayRail__Summaries>
              {deadCount > 0 && (
                <PanelDelayRail__FailureSummary role="status">
                  {deadCount === 1
                    ? "1 command failed"
                    : `${deadCount} commands failed`}
                </PanelDelayRail__FailureSummary>
              )}
              {founds.length > 0 && (
                <PanelDelayRail__FoundSummary role="status">
                  {founds.length === 1
                    ? "1 lost command found"
                    : `${founds.length} lost commands found`}
                </PanelDelayRail__FoundSummary>
              )}
            </PanelDelayRail__Summaries>
          )}
        </PanelDelayRail__Rail>
      )}
      {/* Underneath BOTH queues, and outside the toggle button rather than
          inside it. A dismiss control is a button, and a button inside a button
          is a nested interactive: axe fails it, and a real keyboard user gets a
          control they cannot reach past the one wrapping it. */}
      {grown && refusals.length > 0 && (
        <CommandRefusalList refusals={refusals} onDismiss={dismissRefusal} />
      )}
      {grown && losses.length > 0 && (
        <CommandLossList losses={losses} onDismiss={dismissLoss} />
      )}
      {/* Under the losses, because it is one of the two ways a loss ends, and
          the one that keeps its warning colour. */}
      {grown && undelivered.length > 0 && (
        <CommandUndeliveredList
          undelivered={undelivered}
          onDismiss={dismissUndelivered}
        />
      )}
      {/* Last, under the losses, because it is the resolution of one: an
          operator reading down the rail meets the silence and then the answer
          to it. */}
      {grown && founds.length > 0 && (
        <CommandFoundList founds={founds} onDismiss={dismissFound} />
      )}
    </PanelDelayRail__Frame>
  );
}

/**
 * The rail's box, sitting IN the container's reserved top band: the negative
 * top margin pulls it up into that inset exactly, so collapsed it fills the
 * band and adds nothing to the panel's height, and every pixel it grows past
 * the band pushes the glow, the header and the body down. It holds the toggle
 * button and, once open, the outcome boxes under it.
 *
 * The band's permanence is the whole design. A rail that claimed space on
 * arrival pushed every watching widget's content down on a data transition; one
 * that borrowed the header's space drew over the title and took its clicks.
 * Neither is needed once the strip is simply always there: the rail moves into
 * room that was already standing empty, and leaves it standing empty again.
 *
 * With no rail chrome inside it the band reads as the widget's top padding, and
 * that is what it is.
 */
const PanelDelayRail__Frame = styled.div`
  /* Never let the container's flex column shrink this below its content: the
     grown rail takes its full height and the body gives up the difference. */
  flex: 0 0 auto;
  /* Up into the container's own top inset, which is the band. The two numbers
     are one declaration (PanelContainer's --panel-rail-band), so the strip and
     the room made for it cannot drift apart. */
  margin-top: calc(-1 * var(--panel-rail-band, var(--space-16, 16px)));
  min-height: var(--panel-rail-band, var(--space-16, 16px));
`;

/**
 * The rail button, filling the reserved band. A real `<button>` for the pin
 * disclosure, reset to carry no button chrome.
 *
 * Collapsed (the resting state, kept COMPACT): a thin strip in NORMAL FLOW,
 * capped at the band's own height, all handles OVERLAID (grid, every child in
 * the one cell) so several grazing glows and a mini sparkline share it rather
 * than crowd. It covers nothing, and the title sits exactly where the empty
 * band leaves it. GROWN on hover OR pin (click): the strip becomes a flex
 * column that stacks each command's fuller view and outgrows the band, pushing
 * the title + body DOWN by ordinary flow (the operator is happy for content to
 * slide on expand). Hover is a transient preview; a click PINS it open.
 */
const grownRail = css`
  display: flex;
  flex-direction: column;
  gap: var(--space-8, 8px);
  /* Generous cap the grown content fits inside; the visible height settles at
     the content height, the extra headroom is never seen. A stream + discrete
     combined rail needs the room, so nothing clips. */
  max-height: 800px;
  /* Fully full-bleed: no padding at all, so the pinned stream GRAPH spans the
     true widget width edge to edge and grazes the top. Each child owns its own
     inset instead: the stream's legend row takes the standard content margin,
     and the discrete row-container insets itself evenly. */
  padding: 0;

  & > * {
    grid-area: auto;
  }
`;

const PanelDelayRail__Rail = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  /* The bleed moved to PanelDelayRail__Frame, which is what the panel measures
     and what both the button and the refusal boxes have to line up inside. */
  margin: 0;
  padding: 0;
  /* Positioning context for the open-only collapse hint below. */
  position: relative;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: inherit;

  /* Collapsed: the reserved band, children stacked in a single grid cell.
     Height is capped by max-height so opening can animate (auto is not
     animatable): the element's height follows min(content, max-height), so
     growing the cap grows the rail smoothly and shrinking it collapses it. */
  display: grid;
  height: auto;
  /* The band, and nothing over it. Both a discrete rail's grazing glows and a
     stream's mini graph draw at this height, so the strip a widget reserves is
     the strip the rail fills. */
  max-height: var(--panel-rail-band, var(--space-16, 16px));
  overflow: hidden;
  transition: max-height var(--duration-slow, 200ms) var(--ease-standard, ease);

  & > * {
    grid-area: 1 / 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }

  /* Open (pinned or the hover preview) grows past the band. Both arrive as
     React state now rather than a CSS hover rule, because the published height
     has to be the grown one only. */
  &[data-grown="true"] {
    ${grownRail}
  }
`;

/**
 * The pinned-only visible cue that the rail is a toggle: a click (or Enter /
 * Space, it is the same `<button>`) collapses it back to the minified strip.
 * `aria-hidden`, the button's own `aria-label` already carries this for
 * assistive tech; this is purely the sighted affordance so pinning doesn't
 * read as a one-way action.
 */
/**
 * The whole of a refusal in the COLLAPSED strip: how many commands the game
 * said no to, in the warning colour, sharing the band with the delay glows
 * (every rail child sits in the one grid cell). It says only the count on
 * purpose, since a hundred-character sentence cannot live in a 16px band, and
 * opening the rail is what gets the operator the reason.
 *
 * `role="status"` so a refusal arriving while the operator is looking elsewhere
 * is announced, politely: a refusal is a mission-state change, not streaming
 * telemetry.
 */
const PanelDelayRail__FailureSummary = styled.span`
  color: var(--color-status-warning-fg);
`;

/** The end-aligned run both collapsed-strip counts sit in. */
const PanelDelayRail__Summaries = styled.span`
  align-self: center;
  justify-self: end;
  display: flex;
  gap: var(--space-8, 8px);
  padding: 0 var(--space-16, 16px);
  font-size: var(--font-size-xs);
  /* Flush, not the browser's metrics-based "normal": this is single-line chrome
     text that never wraps, and it has to fit the reserved band. At the body
     line height an xs glyph carries a 16.8px line box on a coarse pointer,
     which is taller than the band itself, so the count would clip on the one
     device most likely to be showing it. Flush shrinks the box to the font's
     own metrics and the text centres in the strip. */
  line-height: var(--line-height-flush, 1);
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  pointer-events: none;
`;

/**
 * The whole of a found in the COLLAPSED strip: how many commands the operator
 * was told were lost and which have since answered, in the notice colour rather
 * than the warning one beside it. Counted and coloured apart from the failure
 * summary because it says the opposite thing, and opening the rail is what gets
 * the operator each command's actual outcome.
 *
 * `role="status"`, so a command turning up executed reaches an operator looking
 * elsewhere. Polite by implication, never assertive: assertive is ABORT's.
 */
const PanelDelayRail__FoundSummary = styled.span`
  color: var(--color-status-info-fg);
`;

const PanelDelayRail__CollapseHint = styled.span`
  position: absolute;
  top: var(--space-4, 4px);
  right: var(--space-16, 16px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 1;
`;
