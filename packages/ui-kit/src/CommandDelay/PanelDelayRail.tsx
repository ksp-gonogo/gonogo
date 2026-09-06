import { useEffect, useRef, useState } from "react";
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
import { usePanelRailTarget } from "./PanelRailTarget";
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
 * inside it, an empty 16px band on every delayed link.
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
 * v3/v4 shape: the rail is a single `<button>` sitting flush at the true top
 * edge and spanning the full widget width. Collapsed it is the 16px drag-bar
 * strip (grazing glows for discrete commands, a mini sparkline for a stream);
 * with several commands in flight their summaries overlay in that one band.
 *
 * **The collapsed rail costs the widget NO layout space.** It is drawn OVER the
 * panel's top edge, out of flow, and publishes no height at all, so a widget
 * that is merely watching a command in flight keeps every row of its body and
 * its title does not move. Activating it (click / Enter / Space, native
 * `<button>`; Esc collapses) PINS it, and pinning GROWS the rail into real
 * layout space: each command switches to its fuller `inline` view (the discrete
 * list, the full-height stream graph with its labels back), the button returns
 * to normal flow, and because the measured height feeds `--panel-rail-height`,
 * the Panel title and body are pushed DOWN. Content sliding is the price of
 * OPENING the rail, and it is only ever charged then.
 * `aria-pressed` / `aria-expanded` carry the state. Activating it AGAIN
 * (click / Enter / Space / Esc) un-pins and re-minifies it: pin is a true
 * toggle, not a one-way expand, and the pinned rail shows a small "▲"
 * hint so that's discoverable, not just present in the aria-label (which
 * carries the word "collapse" for assistive tech; the visible hint stays
 * icon-only). Hover
 * separately grows it as a transient preview (pointer devices only, gone on
 * pointer-leave, a no-op once pinned); an explicit un-pin click wins over a
 * pointer that simply hasn't moved off the rail yet, see
 * `suppressHoverPreview` below.
 *
 * Renders `null` when no active handle has anything to draw, so a widget whose
 * commands are all instant or idle gets no rail element at all and the panel
 * reads the `--panel-rail-height` fallback, which a collapsed rail also leaves
 * standing since it publishes nothing. "Anything to draw" is
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
  const railRef = useRef<HTMLDivElement>(null);
  const targetRef = usePanelRailTarget();
  const [pinned, setPinned] = useState(false);
  // Suppresses the CSS hover-preview immediately after an explicit un-pin
  // click made while the pointer is still over the rail, the common case
  // (the pointer is right there because the operator just clicked it). Without
  // this, `:hover` alone keeps forcing the grown layout, so the click's
  // un-pin is invisible until the pointer happens to leave, reading as "there
  // is no way to collapse it back".
  //
  // Cleared on the pointer's next genuine ENTRY, not its exit: collapsing the
  // rail out from under a stationary pointer changes the CSS `:hover` match
  // (browsers re-run hit-testing after layout) WITHOUT dispatching a real
  // `mouseleave` DOM event, real leave/enter events only fire on actual
  // pointer movement, so a leave-triggered clear can be silently skipped when
  // the click lands beyond the collapsed strip's shorter bounds. A fresh
  // `mouseenter`, by contrast, is spec-guaranteed on real re-entry, so it is
  // the reliable place to lift the suppression for the next hover.
  const [suppressHoverPreview, setSuppressHoverPreview] = useState(false);

  /*
   * Re-run when the rail mounts / unmounts (hasContent flip). On mount it
   * observes the rail FRAME and publishes its height onto the target element; on
   * unmount it removes the var so the panel falls back to its no-rail offset.
   * The single ResizeObserver watches ONLY the frame, so a pin GROWING the rail
   * republishes the taller height (pushing the header + body down) with no
   * measure-render-measure loop. It is the frame rather than the toggle button
   * because the refusal boxes are the button's SIBLING (see the render below):
   * measuring the button alone would leave their height out of the var and let
   * the panel body render straight through them.
   *
   * A COLLAPSED rail measures zero, because the frame's CSS lifts the button out
   * of flow to draw it over the panel's top edge, and a zero measurement REMOVES
   * the var rather than publishing `0px`. The two are not the same number: the
   * panel's fallback is minus the body's own top inset, so a literal zero would
   * still push the header down by the 8px that fallback exists to cancel. This
   * is also why the flow switch is left to CSS: the hover preview grows the rail
   * without React hearing about it, and the observer sees the resulting height
   * either way.
   *
   * hasContent is the mount/unmount TRIGGER, not a value read in the body, which
   * the exhaustive-deps rule cannot see.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasContent is the rail-mount/unmount trigger, not a body input
  useEffect(() => {
    const rail = railRef.current;
    const target = targetRef?.current;
    if (!rail || !target || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const height = entries[entries.length - 1]?.contentRect.height ?? 0;
      if (height > 0) {
        target.style.setProperty("--panel-rail-height", `${height}px`);
      } else {
        target.style.removeProperty("--panel-rail-height");
      }
    });
    ro.observe(rail);
    return () => {
      ro.disconnect();
      target.style.removeProperty("--panel-rail-height");
    };
  }, [hasContent, targetRef]);

  if (!hasContent) return null;

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
    /* The pin and hover-suppression state is carried on the FRAME as well as on
       the button, because the frame is what decides whether the rail is in the
       panel's flow at all and CSS cannot ask a child. */
    <PanelDelayRail__Frame
      data-panel-rail-frame=""
      data-pinned={pinned}
      data-suppress-hover={suppressHoverPreview}
      ref={railRef}
    >
      <PanelDelayRail__Rail
        type="button"
        data-panel-rail=""
        data-pinned={pinned}
        data-suppress-hover={suppressHoverPreview}
        aria-pressed={pinned}
        aria-expanded={pinned}
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
        onMouseEnter={() => setSuppressHoverPreview(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && pinned) {
            e.stopPropagation();
            setPinned(false);
          }
        }}
      >
        {pinned && (
          <PanelDelayRail__CollapseHint aria-hidden="true">
            ▲
          </PanelDelayRail__CollapseHint>
        )}
        {ordered.map((h) => (
          <CommandDelay
            key={h.id}
            handle={h}
            variant={pinned ? "expanded" : "rail"}
            ariaLabel={pinned ? "Delay detail" : undefined}
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
            variant={pinned ? "expanded" : "rail"}
          />
        ))}
        {!pinned && (deadCount > 0 || founds.length > 0) && (
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
      {/* Underneath BOTH queues, and outside the toggle button rather than
          inside it. A dismiss control is a button, and a button inside a button
          is a nested interactive: axe fails it, and a real keyboard user gets a
          control they cannot reach past the one wrapping it. */}
      {pinned && refusals.length > 0 && (
        <CommandRefusalList refusals={refusals} onDismiss={dismissRefusal} />
      )}
      {pinned && losses.length > 0 && (
        <CommandLossList losses={losses} onDismiss={dismissLoss} />
      )}
      {/* Under the losses, because it is one of the two ways a loss ends, and
          the one that keeps its warning colour. */}
      {pinned && undelivered.length > 0 && (
        <CommandUndeliveredList
          undelivered={undelivered}
          onDismiss={dismissUndelivered}
        />
      )}
      {/* Last, under the losses, because it is the resolution of one: an
          operator reading down the rail meets the silence and then the answer
          to it. */}
      {pinned && founds.length > 0 && (
        <CommandFoundList founds={founds} onDismiss={dismissFound} />
      )}
    </PanelDelayRail__Frame>
  );
}

/**
 * The measured rail box: the toggle button plus, when expanded, the refusal
 * boxes under it. The FRAME carries the flush-to-the-edges bleed, not the
 * button (it cancels the panel body's own side inset), so both children line up
 * on the same edges rather than each choosing its own.
 *
 * It is also where the rail's TWO MODES live, which is the whole of the passive
 * rail's cost to a widget:
 *
 * - COLLAPSED, the button is absolutely positioned over the panel's top edge and
 *   the frame measures ZERO. A widget only watching a command in flight keeps
 *   every pixel of its body: the band is drawn on top of the panel's first 16px
 *   rather than a row pushed in above the title. That is the fix for the passive
 *   rail costing every widget its first rows the instant anything went in flight
 * - GROWN (pinned, or the hover preview), the button returns to normal flow and
 *   the frame takes its top bleed back, so the measured height republishes and
 *   the title + body slide down. Content moving is what the operator asked for
 *   when they open the rail, and only then
 *
 * Both switches are CSS rather than React state, because the hover preview is
 * CSS: `:hover` matches the frame while the pointer is over its out-of-flow
 * child, so one selector covers pointer preview and pin alike.
 */
const grownFrame = css`
  /* Cancels the body's own top inset, so the grown rail starts at the panel's
     true top edge exactly as it did before it learnt to collapse. */
  margin-top: calc(-1 * var(--space-8, 8px));

  & > [data-panel-rail] {
    position: relative;
    z-index: auto;
  }
`;

const PanelDelayRail__Frame = styled.div`
  /* Never let the panel scroller's flex layout shrink this below its content:
     the grown rail takes its full height and the body scrolls under it. */
  flex: 0 0 auto;
  /* The containing block for the collapsed rail's out-of-flow band. */
  position: relative;
  margin: 0 calc(-1 * var(--space-16, 16px));

  & > [data-panel-rail] {
    position: absolute;
    /* Up over the body's top inset, so the band grazes the panel's true top
       edge rather than starting a padding's width below it. */
    top: calc(-1 * var(--space-8, 8px));
    left: 0;
    right: 0;
    /* Over the sticky header (Panel.tsx's z-index 2), which is transparent and
       sits in the same strip: below it the band would be un-clickable, and the
       disclosure is the only way a touch operator opens the rail at all. Local
       sibling ordering inside the panel's own stacking context, so no named z
       rung. */
    z-index: 3;
  }

  &[data-pinned="true"] {
    ${grownFrame}
  }

  @media (hover: hover) {
    &:hover:not([data-suppress-hover="true"]) {
      ${grownFrame}
    }
  }
`;

/**
 * The rail button. Flush to the true top-left-right edges (cancels the body's
 * own top + side inset, so it sits at the very top with no dead band above it
 * and spans the full width; the sticky header's offset accounts for the flush
 * rail, see PanelStickyHeader). A real `<button>` for the pin disclosure, reset
 * to carry no button chrome.
 *
 * Collapsed (the resting state, kept COMPACT): a thin band, all handles OVERLAID
 * (grid, every child in the one cell) so several grazing glows + a mini sparkline
 * share the top edge rather than crowd. The frame holds it OUT OF FLOW there, so
 * the band lies over the panel's first 16px and the title stays exactly where a
 * panel with no rail puts it. GROWN on hover OR pin (click): the band becomes a
 * flex column that stacks each command's fuller view, the frame puts it back in
 * flow, and the republished `--panel-rail-height` pushes the title + body DOWN
 * (the operator is happy for content to slide on expand; growth eats the
 * stream-to-title padding first). Hover is a transient preview on pointer
 * devices; a click PINS it open. Coarse pointers get a taller collapsed strip
 * and rely on the pin (no hover).
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
  /* Positioning context for the pinned-only collapse hint below. The FRAME
     overrides this to absolute while collapsed, which is what keeps a passive
     rail out of the panel's flow; both values position the hint. */
  position: relative;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: inherit;

  /* Collapsed: one 16px band, children stacked in a single grid cell. Height is
     capped by max-height so pinning can animate it open (auto is not
     animatable): the element's height follows min(content, max-height), so
     growing the cap grows the rail smoothly and shrinking it collapses it. */
  display: grid;
  height: auto;
  /* Cap collapsed height so it stays a thin band: a discrete-only rail settles
     at its 16px grazing-glow height (height:auto), a stream at its 32px mini
     graph, both under this cap. */
  max-height: 32px;
  overflow: hidden;
  transition: max-height var(--duration-slow, 200ms) var(--ease-standard, ease);

  & > * {
    grid-area: 1 / 1;
  }

  @media (pointer: coarse) {
    max-height: 36px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }

  /* Pinned (sticky) grows. */
  &[data-pinned="true"] {
    ${grownRail}
  }

  /* Hover is a transient preview grow on pointer devices only (touch has no
     hover and relies on the pin). A pinned rail is already grown, so hover is a
     no-op there. The data-suppress-hover exclusion is the un-pin-while-hovering
     escape hatch above: an explicit click-to-collapse wins over a pointer that
     merely never moved. */
  @media (hover: hover) {
    &:hover:not([data-suppress-hover="true"]) {
      ${grownRail}
    }
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
