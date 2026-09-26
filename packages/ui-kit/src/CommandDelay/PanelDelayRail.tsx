import { useState } from "react";
import styled, { css } from "styled-components";
import { focusRingInset } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { CommandDelay } from "./CommandDelay";
import {
  CommandFoundList,
  commandFoundSentence,
  type RailFound,
} from "./CommandFoundList";
import {
  CommandLossList,
  commandLossSentence,
  type RailLoss,
} from "./CommandLossList";
import { CommandRefusalList, type RailRefusal } from "./CommandRefusalList";
import {
  CommandUndeliveredList,
  commandUndeliveredSentence,
  type RailUndelivered,
} from "./CommandUndeliveredList";
import { STREAM_MIN_DELAY_SECONDS } from "./ControlDelayStream";
import { commandRefusalSentence } from "./commandRefusalSentence";
import { type CommandHandle, useActiveHandles } from "./DelayRailContext";
import { railMark } from "./railTags";

/**
 * Whether a handle's `CommandDelay` would draw anything, mirroring its own
 * null decision: a continuous handle needs real delay AND buffers, a discrete
 * one needs in-flight rows. An idle handle stays registered but draws no rail
 * chrome.
 */
function handleHasContent(handle: CommandHandle): boolean {
  if (railMark(handle.tags) === "ribbon") {
    const delay = handle.effectiveDelaySeconds;
    const marks = (handle.streams?.length ?? 0) + (handle.ribbons?.length ?? 0);
    // The graph's own floor, not a positive-delay test, so the rail never mounts around nothing.
    return delay !== null && delay >= STREAM_MIN_DELAY_SECONDS && marks > 0;
  }
  return handle.inFlight.length > 0;
}

/**
 * The Panel-owned signal-delay rail. Reads the active command handles from the
 * nearest `DelayRailContext` and renders each one's delay UI through
 * `CommandDelay`. Takes no prop.
 *
 * **The band is RESERVED, not taken.** Every panel stands the same strip up at
 * its top edge whether or not it has a command to show, so a command going up
 * costs the widget nothing. In a headed panel the rail is the first row of
 * `PanelStickyTop`; headless or under a `floatingHeader` it is the container's
 * first child, pulled up into the inset `PanelContainer` reserves.
 *
 * Collapsed, the rail sits in normal flow inside the band and moves nothing.
 * Activating it (a native `<button>`; Esc collapses) PINS it, and pinning
 * GROWS it: each command switches to its `expanded` view and the title and
 * body are pushed down. Opened while the body is already scrolled, it extends
 * over the content instead, so the scroll position is kept. `aria-pressed`
 * carries the pin; hover is a transient preview that says nothing to assistive
 * tech.
 *
 * The band stays EMPTY when nothing has anything to draw. "Anything" is five
 * things: in flight, refused, unanswered, found and never sent. The last four
 * are terminal, with nothing in flight, so they are asked for separately.
 */
export function PanelDelayRail() {
  const handles = useActiveHandles();
  const visible = handles.filter(handleHasContent);
  // Outcomes come from EVERY registered handle: a settled command has nothing in flight, so `handleHasContent` would hide it.
  const refusals: RailRefusal[] = handles.flatMap((h) =>
    (h.refusals ?? []).map((r) => ({ ...r, tags: h.tags })),
  );
  const losses: RailLoss[] = handles.flatMap((h) =>
    (h.losses ?? []).map((l) => ({ ...l, tags: h.tags })),
  );
  // A found reverses a failure, so it is never counted with the dead dispatches.
  const founds: RailFound[] = handles.flatMap((h) =>
    (h.founds ?? []).map((f) => ({ ...f, tags: h.tags })),
  );
  // An undelivered command provably did not run, so it counts with the failures.
  const undelivered: RailUndelivered[] = handles.flatMap((h) =>
    (h.undelivered ?? []).map((u) => ({ ...u, tags: h.tags })),
  );
  const deadCount = refusals.length + losses.length + undelivered.length;
  const hasContent = visible.length > 0 || deadCount > 0 || founds.length > 0;
  const [pinned, setPinned] = useState(false);
  // Hover preview is React state, not CSS `:hover`, so one flag decides both the height and which view each command draws.
  const [previewing, setPreviewing] = useState(false);
  /*
   * An un-pin click wins over a pointer still resting on the rail. Cleared on
   * the next real `mouseenter`, not on leave: collapsing under a stationary
   * pointer dispatches no `mouseleave`.
   */
  const [suppressHoverPreview, setSuppressHoverPreview] = useState(false);
  const grown = pinned || (previewing && !suppressHoverPreview);

  // Growing the rail moves the title and body by ordinary flow; there is no height to measure or publish.

  // Continuous on top, discrete underneath, each keeping its own order.
  const ordered = [
    ...visible.filter((h) => railMark(h.tags) === "ribbon"),
    ...visible.filter((h) => railMark(h.tags) !== "ribbon"),
  ];

  // Each dismiss routes to the handle that owns the outcome; absent when no handle can dismiss.
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
    // An EMPTY band carries only its own marker, since every widget renders it.
    <PanelDelayRail__Frame data-panel-rail-frame="">
      {/*
        The rail's one announcer, outside the toggle. Mounted once a command
        registers, before any outcome exists, so the first outcome lands in a
        region assistive tech is already watching.
      */}
      {handles.length > 0 && (
        <LiveRegion visuallyHidden additionsOnly>
          {refusals.map((r) => (
            <span key={`refusal:${r.id}`}>{commandRefusalSentence(r)}</span>
          ))}
          {losses.map((l) => (
            <span key={`loss:${l.id}`}>{commandLossSentence(l)}</span>
          ))}
          {undelivered.map((u) => (
            <span key={`undelivered:${u.id}`}>
              {commandUndeliveredSentence(u)}
            </span>
          ))}
          {founds.map((f) => (
            <span key={`found:${f.id}`}>{commandFoundSentence(f)}</span>
          ))}
        </LiveRegion>
      )}
      {/* Nothing to draw leaves the band standing EMPTY: the strip is the panel's, not the traffic's. */}
      {!hasContent ? null : (
        <PanelDelayRail__Rail
          type="button"
          data-panel-rail=""
          data-grown={grown}
          data-pinned={pinned}
          data-suppress-hover={suppressHoverPreview}
          aria-pressed={pinned}
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
              // As with the un-pin click, a resting pointer must not hold the preview open.
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
              // A handle that names its own graph keeps that name at both heights.
              ariaLabel={h.ariaLabel ?? (grown ? "Delay detail" : undefined)}
            />
          ))}
          {!grown && (deadCount > 0 || founds.length > 0) && (
            // One run for both counts, since they share the band's single grid cell.
            <PanelDelayRail__Summaries>
              {deadCount > 0 && (
                <PanelDelayRail__FailureSummary>
                  {deadCount === 1
                    ? "1 command failed"
                    : `${deadCount} commands failed`}
                </PanelDelayRail__FailureSummary>
              )}
              {founds.length > 0 && (
                <PanelDelayRail__FoundSummary>
                  {founds.length === 1
                    ? "1 lost command found"
                    : `${founds.length} lost commands found`}
                </PanelDelayRail__FoundSummary>
              )}
            </PanelDelayRail__Summaries>
          )}
        </PanelDelayRail__Rail>
      )}
      {/* Outside the toggle button: a dismiss button inside it would be a nested interactive. */}
      {grown && refusals.length > 0 && (
        <CommandRefusalList
          refusals={refusals}
          onDismiss={dismissRefusal}
          live={false}
        />
      )}
      {grown && losses.length > 0 && (
        <CommandLossList losses={losses} onDismiss={dismissLoss} live={false} />
      )}
      {grown && undelivered.length > 0 && (
        <CommandUndeliveredList
          undelivered={undelivered}
          onDismiss={dismissUndelivered}
          live={false}
        />
      )}
      {/* Last, so reading down the rail meets the silence and then its answer. */}
      {grown && founds.length > 0 && (
        <CommandFoundList
          founds={founds}
          onDismiss={dismissFound}
          live={false}
        />
      )}
    </PanelDelayRail__Frame>
  );
}

/**
 * The rail's box: exactly the band tall when collapsed, pushing the header and
 * body down by every pixel it grows past it. The band is permanent, so a
 * command arriving never moves a watching widget's content. The negative top
 * margin pulls it into `PanelContainer`'s top inset in the container placement;
 * `PanelStickyTop` gives it back inside the sticky unit.
 */
const PanelDelayRail__Frame = styled.div`
  /* Never shrinks below its content: the grown rail keeps its full height and the body gives up the difference. */
  flex: 0 0 auto;
  /* Fully opaque: content scrolls under the rail, and a translucent base would ghost a delay reading rather than mask it. */
  background: var(--color-surface-panel);
  /* Up into the container's top inset, the band; both read --panel-rail-band, so they cannot drift. */
  margin-top: calc(-1 * var(--panel-rail-band));
  min-height: var(--panel-rail-band);
`;

/**
 * The rail button, filling the reserved band: a real `<button>` for the pin
 * disclosure, with no button chrome. Collapsed, every handle overlays in one
 * grid cell capped at the band's height. Grown (hover or pin), it becomes a
 * flex column that outgrows the band and pushes the title and body down.
 */
const grownRail = css`
  display: flex;
  flex-direction: column;
  gap: var(--gap-delay-rail);
  /* A generous cap the grown content fits inside; the visible height settles at the content height. */
  max-height: 800px;
  /* Full-bleed, so the stream graph spans the widget edge to edge; each child owns its own inset. */
  padding: 0;

  & > * {
    grid-area: auto;
  }
`;

const PanelDelayRail__Rail = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  position: relative;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: inherit;

  /* Height follows min(content, max-height), so animating max-height opens and collapses the rail (auto is not animatable). */
  display: grid;
  height: auto;
  /* The band, and nothing over it: the strip a widget reserves is the strip the rail fills. */
  max-height: var(--panel-rail-band);
  overflow: hidden;
  transition: max-height var(--duration-slow) var(--ease-standard);

  & > * {
    grid-area: 1 / 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  ${focusRingInset}

  /* Open (pinned or hover preview) grows past the band, driven by React state because the published height must be the grown one only. */
  &[data-grown="true"] {
    ${grownRail}
  }
`;

/**
 * The collapsed strip's failure count: only the count, since a sentence cannot
 * fit the band. Not a live region; the rail's own announcer reads each outcome.
 */
const PanelDelayRail__FailureSummary = styled.span`
  color: var(--color-status-warning-fg-muted);
`;

/** The end-aligned run both collapsed-strip counts sit in. */
const PanelDelayRail__Summaries = styled.span`
  align-self: center;
  justify-self: end;
  display: flex;
  gap: var(--gap-rail-summaries);
  padding: 0 var(--gutter-panel);
  font-size: var(--font-size-compact);
  /* Flush, so single-line chrome text fits the reserved band on a coarse pointer too. */
  line-height: var(--line-height-flush);
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  pointer-events: none;
`;

/** The collapsed strip's found count, in the notice colour because it says the opposite of the failure count. */
const PanelDelayRail__FoundSummary = styled.span`
  color: var(--color-status-info-fg);
`;

/** The pinned rail's sighted cue that it is a toggle; the button's `aria-label` carries it for assistive tech. */
const PanelDelayRail__CollapseHint = styled.span`
  position: absolute;
  top: var(--offset-rail-hint);
  right: var(--gutter-panel);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 1;
`;
