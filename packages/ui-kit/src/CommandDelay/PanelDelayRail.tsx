import { useEffect, useId, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { focusRingInset } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { Tooltip } from "../Tooltip";
import { TONE_TEXT } from "../tone";
import { CommandDelay } from "./CommandDelay";
import { CommandList } from "./CommandList";
import { STREAM_MIN_DELAY_SECONDS } from "./ControlDelayStream";
import {
  commandFailedSentence,
  type RailFailed,
} from "./commandFailedSentence";
import { commandFoundSentence, type RailFound } from "./commandFoundSentence";
import { commandLossSentence, type RailLoss } from "./commandLossSentence";
import {
  commandRefusalSentence,
  type RailRefusal,
} from "./commandRefusalSentence";
import {
  commandUndeliveredSentence,
  type RailUndelivered,
} from "./commandUndeliveredSentence";
import {
  commandWarningSentence,
  type RailWarning,
} from "./commandWarningSentence";
import {
  type CommandHandle,
  useActiveHandles,
  useDelayRailStore,
} from "./DelayRailContext";
import { InFlightLanes } from "./InFlightList";
import { claimRailAnnouncer } from "./railAnnouncer";
import { railMark } from "./railTags";
import { SETTLE_FADE_MS } from "./settle";
import {
  type InFlightCommandLike,
  secondsToRailEnd,
  toInFlightListItems,
} from "./toInFlightListItems";

/**
 * Whether a handle's `CommandDelay` would draw anything, mirroring its own
 * null decision: a continuous handle needs real delay and buffers, a discrete
 * one needs in-flight rows. An idle handle stays registered but draws no rail
 * chrome.
 */
/*
 * One row per command across the panel's handles: a command another screen
 * sent is found by every handle of its command, and one handle's own dispatch
 * by every other handle of the same command, all under the same id.
 */
function withoutRepeatedRows(
  handles: readonly CommandHandle[],
): CommandHandle[] {
  const seen = new Set<string>();
  return handles.map((handle) => {
    const rows = handle.inFlight.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
    return rows.length === handle.inFlight.length
      ? handle
      : { ...handle, inFlight: rows };
  });
}

/*
 * One command's outcome reaches every handle of its command on the panel: the
 * one that sent it from its own reply, and the others from the centre's
 * report. It is drawn once.
 */
function firstOfEachId<Item extends { id: string }>(list: Item[]): Item[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/*
 * A warning names its command and says one thing, and a continuous input
 * carries the same one on every dispatch, so each is drawn once.
 */
function distinctWarnings(handles: readonly CommandHandle[]): RailWarning[] {
  const byText = new Map<string, RailWarning>();
  for (const handle of handles) {
    for (const warned of handle.warnings ?? []) {
      const key = `${warned.command}\u0000${warned.label}\u0000${warned.warning}`;
      if (!byText.has(key)) {
        byText.set(key, { ...warned, id: key, tags: handle.tags });
      }
    }
  }
  return [...byText.values()];
}

interface DepartedRow {
  handleId: string;
  row: InFlightCommandLike;
}

const NO_DEPARTED: ReadonlyMap<string, DepartedRow> = new Map();

const UNANSWERED_PHASES = new Set(["overdue", "lost"]);

/** The ids of every command a handle reports refused, failed or never sent, and of every late one that ran. */
function outcomeIds(handles: readonly CommandHandle[]): {
  failed: Set<string>;
  ran: Set<string>;
} {
  const failed = new Set<string>();
  const ran = new Set<string>();
  for (const h of handles) {
    for (const r of h.refusals ?? []) failed.add(r.id);
    for (const f of h.failures ?? []) failed.add(f.id);
    for (const u of h.undelivered ?? []) failed.add(u.id);
    for (const f of h.founds ?? [])
      (f.outcome === "ran" ? ran : failed).add(f.id);
  }
  return { failed, ran };
}

/*
 * A command that leaves the rail is drawn a while longer so its mark never just
 * vanishes. Answered, it carries on through the confirmed stage to the end of
 * the rail at the pace it travelled, then fades. Refused, failed, or dismissed
 * while unanswered, it fades where it was. Kept here rather than in the strip
 * because a handle with no rows left is not drawn at all.
 */
function useSettlingRows(handles: readonly CommandHandle[]): CommandHandle[] {
  const current = new Map<string, DepartedRow>();
  for (const handle of handles) {
    for (const row of handle.inFlight) {
      if (!row.settling) current.set(row.id, { handleId: handle.id, row });
    }
  }
  const { failed, ran } = outcomeIds(handles);
  const [state, setState] = useState<{
    last: ReadonlyMap<string, DepartedRow>;
    settling: ReadonlyMap<string, DepartedRow>;
  }>({ last: NO_DEPARTED, settling: NO_DEPARTED });
  /*
   * Worked out while rendering, not after: a row that left and came back a
   * render later would be a new mark, which starts where it ends up rather
   * than moving there.
   */
  const gone = [...state.last].filter(([id]) => !current.has(id));
  const rowsChanged =
    gone.length > 0 ||
    current.size !== state.last.size ||
    [...current].some(([id, d]) => state.last.get(id)?.row !== d.row);
  if (rowsChanged) {
    const departed = gone.map(([id, d]): [string, DepartedRow] => {
      const kind =
        failed.has(id) ||
        (UNANSWERED_PHASES.has(d.row.predictedPhase) && !ran.has(id))
          ? ("failed" as const)
          : ("confirmed" as const);
      const settleSeconds = kind === "confirmed" ? secondsToRailEnd(d.row) : 0;
      return [id, { ...d, row: { ...d.row, settling: kind, settleSeconds } }];
    });
    setState({
      last: current,
      settling:
        departed.length === 0
          ? state.settling
          : new Map([...state.settling, ...departed]),
    });
  }
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = timersRef.current;
    for (const [id, d] of state.settling) {
      if (timers.has(id)) continue;
      const timer = setTimeout(
        () => {
          timers.delete(id);
          setState((prev) => {
            const next = new Map(prev.settling);
            next.delete(id);
            return { ...prev, settling: next };
          });
        },
        (d.row.settleSeconds ?? 0) * 1000 + SETTLE_FADE_MS,
      );
      timers.set(id, timer);
    }
  }, [state.settling]);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  if (state.settling.size === 0) return handles as CommandHandle[];
  return handles.map((handle) => {
    const departed = [...state.settling.values()]
      .filter((d) => d.handleId === handle.id && !current.has(d.row.id))
      // An outcome can land a render after its row left, and turns the row it answers.
      .map((d) =>
        d.row.settling === "confirmed" && failed.has(d.row.id)
          ? { ...d.row, settling: "failed" as const, settleSeconds: 0 }
          : d.row.settling === "failed" && ran.has(d.row.id)
            ? {
                ...d.row,
                settling: "confirmed" as const,
                settleSeconds: secondsToRailEnd(d.row),
              }
            : d.row,
      );
    return departed.length === 0
      ? handle
      : { ...handle, inFlight: [...handle.inFlight, ...departed] };
  });
}

function handleHasContent(handle: CommandHandle): boolean {
  if (railMark(handle.tags) === "ribbon") {
    const delay = handle.effectiveDelaySeconds;
    const ribbons = handle.ribbons?.length ?? 0;
    const streams = handle.streams?.length ?? 0;
    if (delay === null || delay <= 0) return false;
    // The graph's own rule, so the rail never mounts around nothing: streams need its floor, ribbons do not.
    return ribbons > 0 || (delay >= STREAM_MIN_DELAY_SECONDS && streams > 0);
  }
  return handle.inFlight.length > 0;
}

/**
 * The panel's delay rail: a strip along the top edge that shows each command
 * the widget has sent, through {@link CommandDelay}, reading them from the
 * nearest {@link DelayRailContext}. Useful for showing the operator which
 * commands are on their way, and which were refused or lost. Used by
 * {@link Panel}.
 *
 * Every panel reserves the strip whether or not it has a command to show, so
 * a command going out never moves the widget. `Panel` draws it itself; in a
 * hand-composed panel, make it the container's first child.
 *
 * Collapsed, the rail sits in normal flow inside the band and moves nothing.
 * It is a disclosure: a native `<button>` laid over the strip controls the
 * detail beside it. Activating it (Esc collapses) pins the rail, and pinning
 * grows it: each command switches to its `expanded` view and the title and
 * body are pushed down. Opened while the body is already scrolled, it extends
 * over the content instead, so the scroll position is kept. `aria-expanded`
 * carries the pin; hover is a transient preview that says nothing to assistive
 * tech. Pinned, the detail takes its own clicks and only the collapse hint
 * toggles.
 *
 * The strip is empty unless a command is in flight, refused, unanswered,
 * found, never sent, answered with a fault, or accepted with a warning. A
 * command in flight is drawn whichever screen of the command centre sent it.
 *
 * `tiny` is for a tiny panel with no header: the empty strip draws no
 * background, so it does not cover the panel's focus ring.
 */
export function PanelDelayRail({ tiny }: { tiny?: boolean } = {}) {
  const handles = useActiveHandles();
  const store = useDelayRailStore();
  useEffect(() => (store ? claimRailAnnouncer(store) : undefined), [store]);
  const visible = withoutRepeatedRows(useSettlingRows(handles)).filter(
    handleHasContent,
  );
  const warnings = distinctWarnings(handles);
  // Outcomes come from EVERY registered handle: a settled command has nothing in flight, so `handleHasContent` would hide it.
  const refusals: RailRefusal[] = firstOfEachId(
    handles.flatMap((h) =>
      (h.refusals ?? []).map((r) => ({ ...r, tags: h.tags })),
    ),
  );
  const losses: RailLoss[] = handles.flatMap((h) =>
    (h.losses ?? []).map((l) => ({ ...l, tags: h.tags })),
  );
  // A found answers an unconfirmed command, so it is never counted with the failures.
  const founds: RailFound[] = firstOfEachId(
    handles.flatMap((h) =>
      (h.founds ?? []).map((f) => ({ ...f, tags: h.tags })),
    ),
  );
  // An undelivered command provably did not run, so it counts with the failures.
  const undelivered: RailUndelivered[] = handles.flatMap((h) =>
    (h.undelivered ?? []).map((u) => ({ ...u, tags: h.tags })),
  );
  // The mod said what became of each of these, and none of them ran.
  const failures: RailFailed[] = firstOfEachId(
    handles.flatMap((h) =>
      (h.failures ?? []).map((f) => ({ ...f, tags: h.tags })),
    ),
  );
  // A loss may still have run, so it is counted as unconfirmed and never as failed.
  const failedCount = refusals.length + undelivered.length + failures.length;
  const hasContent =
    visible.length > 0 ||
    failedCount > 0 ||
    losses.length > 0 ||
    founds.length > 0 ||
    warnings.length > 0;
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
  // With nothing left to show the rail unmounts, so a pin or preview left set would grow the next command's rail before anyone asked.
  useEffect(() => {
    if (hasContent) return;
    setPinned(false);
    setPreviewing(false);
    setSuppressHoverPreview(false);
  }, [hasContent]);
  const detailId = useId();

  // Growing the rail moves the title and body by ordinary flow; there is no height to measure or publish.

  // Continuous on top, discrete underneath, each keeping its own order.
  const ordered = [
    ...visible.filter((h) => railMark(h.tags) === "ribbon"),
    ...visible.filter((h) => railMark(h.tags) !== "ribbon"),
  ];
  const hasGraph = visible.some((h) => railMark(h.tags) === "ribbon");
  const discrete = ordered.filter((h) => railMark(h.tags) !== "ribbon");
  const strip = toInFlightListItems(
    visible
      .filter((h) => railMark(h.tags) !== "ribbon")
      .flatMap((h) => h.inFlight),
  );

  // Each dismiss routes to the handle that owns the outcome; absent when no handle can dismiss.
  const canDismissRefusal = handles.some(
    (h) => h.dismiss && (h.refusals?.length ?? 0) > 0,
  );
  const dismissRefusal = canDismissRefusal
    ? (id: string) => {
        // Every handle holding it, since each draws the same command.
        for (const h of handles) {
          if (h.refusals?.some((r) => r.id === id)) h.dismiss?.(id);
        }
      }
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
  const canDismissFailure = handles.some(
    (h) => h.dismiss && (h.failures?.length ?? 0) > 0,
  );
  const dismissFailure = canDismissFailure
    ? (id: string) => {
        for (const h of handles) {
          if (h.failures?.some((f) => f.id === id)) h.dismiss?.(id);
        }
      }
    : undefined;
  const canDismissFound = handles.some(
    (h) => h.dismiss && (h.founds?.length ?? 0) > 0,
  );
  const dismissFound = canDismissFound
    ? (id: string) => {
        for (const h of handles) {
          if (h.founds?.some((f) => f.id === id)) h.dismiss?.(id);
        }
      }
    : undefined;

  return (
    // An EMPTY band carries only its own marker, since every widget renders it.
    <PanelDelayRail__Frame
      data-panel-rail-frame=""
      $tiny={tiny}
      $hasContent={hasContent}
      /* The frame holds the grown lists as well as the strip, so the pointer moving from the strip onto a list never leaves the area that keeps the preview open. */
      onMouseEnter={() => {
        setSuppressHoverPreview(false);
        setPreviewing(true);
      }}
      onMouseLeave={() => setPreviewing(false)}
    >
      {/*
        The rail's one announcer, outside the toggle. Mounted once a command
        registers, before any outcome exists, so the first outcome lands in a
        region assistive tech is already watching.
      */}
      {handles.length > 0 && (
        <LiveRegion visuallyHidden additionsOnly>
          {refusals.map((r) => (
            <span key={`refusal:${r.id}`}>{commandRefusalSentence(r)} </span>
          ))}
          {losses.map((l) => (
            <span key={`loss:${l.id}`}>{commandLossSentence(l)} </span>
          ))}
          {undelivered.map((u) => (
            <span key={`undelivered:${u.id}`}>
              {commandUndeliveredSentence(u)}{" "}
            </span>
          ))}
          {failures.map((f) => (
            <span key={`failure:${f.id}`}>{commandFailedSentence(f)} </span>
          ))}
          {founds.map((f) => (
            <span key={`found:${f.id}`}>{commandFoundSentence(f)} </span>
          ))}
          {warnings.map((w) => (
            <span key={`warning:${w.id}`}>{commandWarningSentence(w)}</span>
          ))}
        </LiveRegion>
      )}
      {/* Nothing to draw leaves the band standing EMPTY: the strip is the panel's, not the traffic's. */}
      {!hasContent ? null : (
        <PanelDelayRail__Rail
          data-panel-rail=""
          data-grown={grown}
          data-pinned={pinned}
          data-suppress-hover={suppressHoverPreview}
          onKeyDown={(e) => {
            if (e.key === "Escape" && pinned) {
              e.stopPropagation();
              setPinned(false);
              // As with the un-pin click, a resting pointer must not hold the preview open.
              setSuppressHoverPreview(true);
            }
          }}
        >
          {/* Opened with no graph to share, the marks come down into a band of their own, first in the rail. Each names its command on hover and on focus. */}
          {grown && strip.length > 0 && !hasGraph && (
            <PanelDelayRail__GrownStrip>
              <InFlightLanes items={strip} height={LANES_HEIGHT_PX} />
            </PanelDelayRail__GrownStrip>
          )}
          {/* Closed, the marks are tips too small to point at, so the rail's button names the commands in flight; hovering opens the rail, where each mark names its own. */}
          <Tooltip
            text={
              !grown && strip.length > 0
                ? `In flight: ${strip
                    .filter((i) => !i.settling)
                    .map((i) => i.label)
                    .join(", ")}`
                : null
            }
          >
            <PanelDelayRail__Toggle
              type="button"
              aria-expanded={pinned}
              aria-controls={detailId}
              aria-label="Signal-delay detail"
              onClick={() => {
                setPinned((p) => {
                  const next = !p;
                  if (!next) setSuppressHoverPreview(true);
                  return next;
                });
              }}
            >
              {/* Hidden rather than unmounted: a node leaving from under a resting pointer reads to React as the pointer entering the rail. */}
              <PanelDelayRail__CollapseHint aria-hidden="true" hidden={!grown}>
                ▲
              </PanelDelayRail__CollapseHint>
            </PanelDelayRail__Toggle>
          </Tooltip>
          <PanelDelayRail__Detail id={detailId} data-panel-rail-detail="">
            {ordered
              .filter((h) => !grown || railMark(h.tags) === "ribbon")
              .map((h) => (
                <CommandDelay
                  key={h.id}
                  handle={h}
                  variant={grown ? "expanded" : "rail"}
                  // A handle that names its own graph keeps that name at both heights.
                  aria-label={
                    h["aria-label"] ?? (grown ? "Delay detail" : undefined)
                  }
                />
              ))}
            {/* Opened, every command of every handle is one queue, one box. */}
            {grown && discrete.length > 0 && (
              <CommandDelay
                key="queue"
                handles={discrete}
                variant="expanded"
                aria-label="Commands in flight"
              />
            )}
            {!grown &&
              (failedCount > 0 ||
                losses.length > 0 ||
                founds.length > 0 ||
                warnings.length > 0) && (
                // One run for every count, since they share the band's single grid cell.
                <PanelDelayRail__Summaries>
                  {failedCount > 0 && (
                    <PanelDelayRail__WarnSummary>
                      {failedCount === 1
                        ? "1 command failed"
                        : `${failedCount} commands failed`}
                    </PanelDelayRail__WarnSummary>
                  )}
                  {losses.length > 0 && (
                    <PanelDelayRail__WarnSummary>
                      {losses.length === 1
                        ? "1 command unconfirmed"
                        : `${losses.length} commands unconfirmed`}
                    </PanelDelayRail__WarnSummary>
                  )}
                  {warnings.length > 0 && (
                    <PanelDelayRail__WarnSummary>
                      {warnings.length === 1
                        ? "1 warning"
                        : `${warnings.length} warnings`}
                    </PanelDelayRail__WarnSummary>
                  )}
                  {founds.length > 0 && (
                    <PanelDelayRail__FoundSummary>
                      {founds.length === 1
                        ? "1 unconfirmed command answered"
                        : `${founds.length} unconfirmed commands answered`}
                    </PanelDelayRail__FoundSummary>
                  )}
                </PanelDelayRail__Summaries>
              )}
          </PanelDelayRail__Detail>
          {/* Opened over a graph, the marks lie on it; last in the rail, so they paint over the graph and the rail's button. */}
          {grown && strip.length > 0 && hasGraph && (
            <PanelDelayRail__GrownStrip data-over-graph="true">
              <InFlightLanes items={strip} height={GRAPH_HEIGHT_PX} />
            </PanelDelayRail__GrownStrip>
          )}
        </PanelDelayRail__Rail>
      )}
      {/* Outside the rail, so the grown lists push the panel down rather than share the rail's grid cell. */}
      {grown && warnings.length > 0 && (
        <CommandList kind="warned" entries={warnings} live={false} />
      )}
      {grown && refusals.length > 0 && (
        <CommandList
          kind="refused"
          entries={refusals}
          onDismiss={dismissRefusal}
          live={false}
        />
      )}
      {grown && losses.length > 0 && (
        <CommandList
          kind="lost"
          entries={losses}
          onDismiss={dismissLoss}
          live={false}
        />
      )}
      {grown && undelivered.length > 0 && (
        <CommandList
          kind="undelivered"
          entries={undelivered}
          onDismiss={dismissUndelivered}
          live={false}
        />
      )}
      {grown && failures.length > 0 && (
        <CommandList
          kind="failed"
          entries={failures}
          onDismiss={dismissFailure}
          live={false}
        />
      )}
      {/* Last, so reading down the rail meets the silence and then its answer. */}
      {grown && founds.length > 0 && (
        <CommandList
          kind="found"
          entries={founds}
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
const PanelDelayRail__Frame = styled.div<{
  $tiny?: boolean;
  $hasContent?: boolean;
}>`
  /* Never shrinks below its content: the grown rail keeps its full height and the body gives up the difference. */
  flex: 0 0 auto;
  /* Fully opaque so content scrolling under the rail never ghosts through: except a tiny panel's empty band, which paints nothing so the panel's own focus ring stays visible behind it. */
  background: ${({ $tiny, $hasContent }) =>
    $tiny && !$hasContent ? "transparent" : "var(--color-surface-panel)"};
  /* Up into the container's top inset, the band; both read --panel-rail-band, so they cannot drift. */
  margin-top: calc(-1 * var(--panel-rail-band));
  min-height: var(--panel-rail-band);
`;

/**
 * The rail, filling the reserved band. Collapsed, every handle overlays in one
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

  & > *,
  & > [data-panel-rail-detail] > * {
    grid-area: auto;
  }
`;

const PanelDelayRail__Rail = styled.div`
  width: 100%;
  margin: 0;
  padding: 0;
  position: relative;

  /* Height follows min(content, max-height), so animating max-height opens and collapses the rail (auto is not animatable). */
  display: grid;
  height: auto;
  /* The band, and nothing over it: the strip a widget reserves is the strip the rail fills. */
  max-height: var(--panel-rail-band);
  overflow: hidden;
  transition: max-height var(--duration-slow) var(--ease-standard);

  & > *,
  & > [data-panel-rail-detail] > * {
    grid-area: 1 / 1;
  }

  &:not([data-pinned="true"]) > [data-panel-rail-detail] > * {
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  /* Open (pinned or hover preview) grows past the band, driven by React state because the published height must be the grown one only. */
  &[data-grown="true"] {
    ${grownRail}
  }
`;

/**
 * The disclosure button, laid over the whole rail with no chrome of its own, so
 * the strip is one click target and the focus ring traces the rail's edge.
 * Pinned, it lets pointer events through to the detail and takes a click only
 * on its collapse hint.
 */
const PanelDelayRail__Toggle = styled.button`
  appearance: none;
  position: absolute;
  inset: 0;
  border: 0;
  margin: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;

  ${focusRingInset}

  &[aria-expanded="true"] {
    pointer-events: none;
  }

`;

/** The opened graph's height, which the lanes share. */
const GRAPH_HEIGHT_PX = 86;
/** The lanes' own band, where there is no graph to share. */
const LANES_HEIGHT_PX = 40;

/** The opened rail's command marks: over the graph at the top of the rail, or a band of their own in flow. */
const PanelDelayRail__GrownStrip = styled.div`
  pointer-events: none;

  &[data-over-graph="true"] {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }
`;

/**
 * The detail the toggle controls. It generates no box, so each command stays
 * a direct grid or flex item of the rail and lays out exactly as a child of it.
 */
const PanelDelayRail__Detail = styled.div`
  display: contents;
`;

/**
 * The collapsed strip's failure count: only the count, since a sentence cannot
 * fit the band. Not a live region; the rail's own announcer reads each outcome.
 */
const PanelDelayRail__WarnSummary = styled.span`
  color: ${TONE_TEXT.warn};
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
  color: var(--color-info-text);
`;

/**
 * The grown rail's sighted cue that it collapses; `aria-expanded` carries it
 * for assistive tech. Pinned, it is the rail's one click target, reaching past
 * the glyph.
 */
const PanelDelayRail__CollapseHint = styled.span`
  position: absolute;
  top: var(--offset-rail-hint);
  right: var(--gutter-panel);
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: auto;
  cursor: pointer;
  z-index: 1;

  &::before {
    content: "";
    position: absolute;
    inset: calc(-1 * var(--outset-rail-hint-target));
  }
`;
