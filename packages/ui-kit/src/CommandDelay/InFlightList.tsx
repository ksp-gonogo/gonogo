import {
  currentMode,
  delayVisibility,
  useViewClockOptional,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type CSSProperties,
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import styled, { css, keyframes } from "styled-components";
import { Countdown } from "../Countdown";
import { focusRingInset } from "../focusRing";
import { InlineOverflowGlow, useInlineOverflow } from "../inlineOverflow";
import { Tooltip } from "../Tooltip";
import { TONE_MARK, TONE_TEXT } from "../tone";
import { writeQuantity } from "../units";
import { useElementSize } from "../useElementSize";
import { focusBesideDismissed } from "./focusBesideDismissed";
import { SETTLE_FADE_MS } from "./settle";
import { deriveGlyph, PHASE_PROGRESS } from "./toInFlightListItems";

/**
 * Which delay reading a console draws, or `none`. Returned by
 * {@link signalDelayPresentation}.
 */
export type SignalDelayPresentation = "badge" | "strip" | "none";

export interface SignalDelayPresentationInput {
  /**
   * One-way separation in seconds, `null` when there is no measurable path.
   * Neither `null` nor a measured zero gets a badge.
   */
  oneWaySeconds: number | null;
  /**
   * Whether this console can put something in the strip. A read-only viewer
   * gets neither reading at a long delay: no queue, and no cost it ever pays.
   */
  canQueue: boolean;
  /**
   * Force the badge whatever the magnitude, for a terminal in character mode:
   * every keystroke goes on its own, so the strip has nothing to list.
   */
  alwaysBadge?: boolean;
}

/**
 * Which one of the two delay readings a console shows, given the one-way delay
 * between the command centre and its vessel or device:
 *
 *   - a badge is a standing readout of the delay, useful before anything
 *     has been sent
 *   - a strip ({@link InFlightList}) is one row per command in flight, useful
 *     once something is out
 *
 * The two are mutually exclusive: drawn together they say the same number twice
 * in two shapes. The boundary is `currentMode`'s, the same one the engine uses
 * to stage a dispatch rather than send it live. Useful for showing the operator
 * one delay readout, not two. Used by {@link Console}.
 */
export function signalDelayPresentation({
  oneWaySeconds,
  canQueue,
  alwaysBadge = false,
}: SignalDelayPresentationInput): SignalDelayPresentation {
  if (oneWaySeconds === null || delayVisibility(oneWaySeconds) !== "shown") {
    return "none";
  }
  if (alwaysBadge) return "badge";
  if (currentMode({ oneWaySeconds: value("s", oneWaySeconds) }) === "live") {
    return "badge";
  }
  return canQueue ? "strip" : "none";
}

/**
 * Display shape for one delayed command. `etaSeconds` is the
 * caller's choice of clock (reach or reply); `null` renders as "no ETA" (an
 * `overdue` or `lost` entry, or `no-path` mode). Useful for showing the operator
 * one command that has left the command centre. Taken by {@link InFlightList}
 * and built by {@link toInFlightListItems}.
 *
 * @category CommandDelay
 */
export interface InFlightListItem {
  /** Identifies the command. */
  id: string;
  /** What the command is called in the list. */
  label: string;
  /** Seconds until it reaches the craft or is answered, or `null` for none. */
  etaSeconds: number | null;
  /** Where the command is on its way. */
  phase: "in-transit" | "awaiting-reply" | "due" | "overdue" | "lost";
  /**
   * How far the command is along the rail's three equal stages: 1/3 when it
   * reaches the craft, 2/3 when its reply is due, and 1 at the end of the
   * confirmed stage. The `variant="rail"` mark and the `variant="expanded"`
   * bar read it; without it they place the command by phase.
   */
  progress?: number;
  /**
   * The command's own terse glyph ("PRO", "RET", "WARP"), shown in the
   * `variant="expanded"` queue square. Phase is conveyed by colour, never by
   * the glyph. Defaults to an abbreviation of `label`.
   */
  glyph?: string;
  /** Which way the entry crosses: `outbound` to the craft (the default), `inbound` home from it. */
  flow?: "outbound" | "inbound";
  /** True while the route holds the command at a relay: drawn still, in the held colour. */
  held?: true;
  /**
   * True while the entry is kept at its sender for a path that has not opened,
   * so nothing is crossing and no countdown can be given. The entry reads
   * "waiting for a path" where a countdown would be. Useful for showing the
   * operator that a message to a command centre with no path from here is
   * held, not lost. Used by the message queue in Commcast. Draw it with `held`.
   */
  waiting?: true;
  /**
   * Set on a command that has just left. The `rail` and `expanded` variants
   * draw a `confirmed` one moving on to `progress` over `settleSeconds`, then
   * fading, and a `failed` one fading where it was, in the warning colour.
   * Every other variant leaves it out.
   */
  settling?: "confirmed" | "failed";
  /** How long a `confirmed` command takes to reach `progress`, in seconds. */
  settleSeconds?: number;
}

/**
 * How commands reach the vessel, as `useCommand`'s `delayMode` reports it:
 * `live` under the staged threshold, `staged` above it, `no-path` when nothing
 * is measurable. {@link InFlightList} writes it to its root's `data-mode` attribute, for
 * styling, and draws nothing different for it: each command already shows its
 * own phase and countdown, and under `no-path` it shows "no ETA".
 * Useful for styling the list of in-flight commands by how they reach the
 * vessel.
 *
 * @category CommandDelay
 */
export type InFlightListMode = "live" | "staged" | "no-path";

/**
 * How much of each in-flight command {@link InFlightList} draws, by the room
 * it has. Independent of `mode`, which describes how commands reach the vessel.
 * Set with the `density` prop of {@link InFlightList}.
 * Useful for fitting the list of in-flight commands to a wide panel or a
 * narrow one.
 *
 * - `full`: arrow, label and countdown per command, one per line
 * - `compact`: arrow and countdown only; the label moves to the accessible
 *   name and tooltip
 * - `badge`: one chip for the whole set, with the count and the nearest
 *   arrival
 * - `auto` (the default): measures the rendered width and picks one of the
 *   three
 *
 * @category CommandDelay
 */
export type InFlightListDensity = "auto" | "full" | "compact" | "badge";

/**
 * Props for {@link InFlightList}: the commands in flight and how much of each to
 * draw.
 * Useful for choosing which in-flight commands the operator sees and how much
 * of each. Used by {@link InFlightList}.
 *
 * @category CommandDelay
 */
export interface InFlightListProps {
  /** The commands in flight; `toInFlightListItems(handle.inFlight)` builds them. */
  items: InFlightListItem[];
  /** The link's mode, written to `data-mode`. */
  mode?: InFlightListMode;
  /** Defaults to `auto`. */
  density?: InFlightListDensity;
  /**
   * `column` stacks the entries, `row` flows them. A queue under a button
   * group wants a column; one beside an action row wants a row. Row wraps, so
   * it degrades to several short lines rather than overflowing.
   */
  orientation?: "column" | "row";
  /** Accessible label for the list region. Defaults to "In-flight commands". */
  "aria-label"?: string;
  /**
   * `"inline"` (default) is the monospace row/badge list. `"rail"` is the
   * Panel rail's 16px strip: each command is a soft glow grazing the top edge,
   * sweeping left to right by journey progress. `"expanded"` is the pinned
   * detail: a queue square per command. `mode`, `density` and `orientation`
   * apply to `"inline"` only.
   */
  variant?: "inline" | "rail" | "expanded";
  /**
   * Clear an unanswered command (`overdue`/`lost`) from the shared delay queue.
   * When given, the `"expanded"` queue's unanswered squares become real clear buttons.
   * Applies to `"expanded"` only.
   */
  onDismiss?: (id: string) => void;
}

const PHASE_ARROW: Record<InFlightListItem["phase"], string> = {
  "in-transit": "↑",
  "awaiting-reply": "↓",
  due: "↓",
  overdue: "!",
  lost: "?",
};

/**
 * The word an entry with no countdown shows and speaks. A `lost` command got no
 * reply and may still have run, so it reads as unconfirmed, never as failed.
 */
const PHASE_WORD: Record<InFlightListItem["phase"], string> = {
  "in-transit": "in transit",
  "awaiting-reply": "awaiting reply",
  due: "due",
  overdue: "overdue",
  lost: "unconfirmed",
};

/** What an entry with no countdown says: its phase, or that it waits for a path that has not opened. */
function wordOf(item: InFlightListItem): string {
  return item.waiting ? "waiting for a path" : PHASE_WORD[item.phase];
}

/** An inbound entry in transit is coming down, whatever the phase table says a command does. */
function arrowOf(item: InFlightListItem): string {
  if (item.flow === "inbound" && item.phase === "in-transit") return "↓";
  return PHASE_ARROW[item.phase];
}

const ERROR_PHASES = new Set<InFlightListItem["phase"]>(["overdue", "lost"]);

/**
 * Width thresholds for `auto`, in px, set by what the content needs. `full`
 * needs arrow, countdown, gaps and padding plus about 100px of label room;
 * `compact` needs arrow plus countdown. Below that the set collapses to the
 * badge.
 */
const FULL_MIN_WIDTH = 180;
const COMPACT_MIN_WIDTH = 96;

/**
 * The countdown a strip speaks, for the accessible name and a row's `title`.
 * Clamped at zero: a strip shows time remaining, never a negative duration.
 */
function clampedCountdown(seconds: number): string {
  return writeQuantity(value("s", Math.max(0, seconds)));
}

function nearestEta(items: InFlightListItem[]): number | null {
  let best: number | null = null;
  for (const item of items) {
    if (item.etaSeconds === null) continue;
    if (best === null || item.etaSeconds < best) best = item.etaSeconds;
  }
  return best;
}

/** Take the caller's figure again only on a change this large (seconds): its `etaSeconds` drifts by fractions on every re-render. */
const RESYNC_THRESHOLD_SECONDS = 1;

/**
 * The seconds left before something arrives, counted down in game time from
 * the figure the caller passes. Useful for showing the operator the seconds
 * left before a command reaches the vessel. Used by {@link InFlightList}.
 *
 * It follows the game's clock: it stands still while the game is paused and
 * falls at the warp rate under time warp. The caller need not re-render for
 * it to move, and a new `etaSeconds` replaces the count once it differs from
 * the last one taken by a second or more. With no telemetry stream mounted
 * there is no game clock, and it returns `etaSeconds` unchanged.
 */
export function useCountdown(etaSeconds: number | null): number | null {
  const clock = useViewClockOptional();
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [value, setValue] = useState(etaSeconds);
  // The figure last taken from the caller, and the game time it was taken at.
  const seedRef = useRef({ eta: etaSeconds, ut: gameNow(clock) });

  useEffect(() => {
    const last = seedRef.current.eta;
    const jumped =
      (last === null) !== (etaSeconds === null) ||
      (last !== null &&
        etaSeconds !== null &&
        Math.abs(etaSeconds - last) >= RESYNC_THRESHOLD_SECONDS);
    if (jumped) {
      seedRef.current = { eta: etaSeconds, ut: gameNow(clockRef.current) };
      setValue(etaSeconds);
    }
  }, [etaSeconds]);

  /*
   * The interval is only what redraws the number once a second. What it draws
   * is read off the game clock each time, so wall time passing while game time
   * does not (a paused game) moves nothing. Mount-once and not keyed on
   * `etaSeconds`, which drifts every render and would never let a second pass.
   */
  useEffect(() => {
    const id = setInterval(() => {
      const { eta, ut } = seedRef.current;
      if (eta === null) return;
      const now = gameNow(clockRef.current);
      if (now === undefined) return;
      // The figure was taken before the clock had a time: count from the first time it gives.
      if (ut === undefined) {
        seedRef.current = { eta, ut: now };
        return;
      }
      setValue(Math.max(0, eta - (now - ut)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return value;
}

/** The game's present in UT seconds, or `undefined` with no clock or before it has a time. */
function gameNow(
  clock: ReturnType<typeof useViewClockOptional>,
): number | undefined {
  const ut = clock?.utNowEstimate();
  return ut !== undefined && Number.isFinite(ut) ? ut : undefined;
}

/**
 * A list of in-flight commands: rows with per-entry countdowns and phase
 * styling. Useful for showing the operator which commands have left and when
 * each arrives. Used by {@link CommandDelay} and {@link Console}. Renders
 * nothing for an empty set. It has no data hooks; build its items from
 * `useCommand().inFlight` with {@link toInFlightListItems}.
 *
 * @category CommandDelay
 */
export function InFlightList({
  items: allItems,
  mode,
  density = "auto",
  orientation = "column",
  "aria-label": ariaLabel = "In-flight commands",
  variant = "inline",
  onDismiss,
}: InFlightListProps) {
  // Seeded wide so `auto` only ever shrinks from the full form, never flashing a badge on mount.
  const { ref, size } = useElementSize({ w: 320, h: 0 });
  // Only the rail and the queue draw a command fading out; a list row or a count would read it as still out.
  const items =
    variant === "rail" || variant === "expanded"
      ? allItems
      : allItems.filter((item) => !item.settling);

  // The rail and expanded renderings bypass density entirely.
  if (variant === "rail") {
    if (items.length === 0) return null;
    return <InFlightRailStrip items={items} aria-label={ariaLabel} />;
  }
  if (variant === "expanded") {
    if (items.length === 0) return null;
    return (
      <InFlightQueue
        items={items}
        aria-label={ariaLabel}
        onDismiss={onDismiss}
      />
    );
  }

  const resolved: Exclude<InFlightListDensity, "auto"> =
    density !== "auto"
      ? density
      : size.w >= FULL_MIN_WIDTH
        ? "full"
        : size.w >= COMPACT_MIN_WIDTH
          ? "compact"
          : "badge";

  // The size hook keeps its last measurement across an empty render.
  if (items.length === 0) return null;

  if (resolved === "badge") {
    return (
      <InFlightBadge
        ref={ref}
        items={items}
        mode={mode}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <InFlightList__Root
      ref={ref}
      role="list"
      aria-label={ariaLabel}
      data-mode={mode}
      data-density={resolved}
      $row={orientation === "row"}
    >
      {items.map((item) => (
        <InFlightRow
          key={item.id}
          item={item}
          $compact={resolved === "compact"}
        />
      ))}
    </InFlightList__Root>
  );
}

/*
 * Rail strip: each command is a bright dot with a soft halo, at x by how far
 * it is through its trip. It crosses the whole strip and sits at the right end
 * once its reply is due. A command that has just left fades where it last was
 * rather than vanishing. The dot rides the strip's top edge with its top two
 * thirds above it, so only its lower tip and halo show under the panel edge.
 */
const RAIL_DOT_PX = 8;
const RAIL_DOT_SHOWN = 1 / 3;

function InFlightRailStrip({
  items,
  "aria-label": ariaLabel,
}: {
  items: InFlightListItem[];
  "aria-label": string;
}) {
  const live = items.filter((item) => !item.settling);
  return (
    <InFlightRailStrip__Track
      role="img"
      aria-label={`${ariaLabel}: ${live.length} in flight`}
    >
      {items.map((item) => {
        const progress = Math.max(
          0,
          Math.min(1, item.progress ?? PHASE_PROGRESS[item.phase]),
        );
        return (
          <InFlightRailStrip__Dot
            key={item.id}
            {...(item.settling
              ? { "data-role": "settling", "data-settling": item.settling }
              : {
                  "data-role": "glow",
                  "data-phase": item.phase,
                  ...(item.held ? { "data-held": "" } : {}),
                })}
            $settling={item.settling}
            style={
              {
                "--dot-colour": markColour(item),
                "--dot-progress": progress,
                "--settle-seconds": item.settleSeconds ?? 0,
              } as CSSProperties
            }
          />
        );
      })}
    </InFlightRailStrip__Track>
  );
}

/** The whole queue as one chip: how many are out, and when the next one arrives. */
const InFlightBadge = function InFlightBadge({
  ref,
  items,
  mode,
  "aria-label": ariaLabel,
}: {
  ref: RefObject<HTMLDivElement>;
  items: InFlightListItem[];
  mode?: InFlightListMode;
  "aria-label": string;
}) {
  const countdown = useCountdown(nearestEta(items));
  const worst = items.some((i) => ERROR_PHASES.has(i.phase));
  const summary =
    countdown === null
      ? `${items.length} in flight`
      : `${items.length} in flight, next in ${clampedCountdown(countdown)}`;
  return (
    <Tooltip text={items.map((i) => i.label).join("\n")} focusable>
      <InFlightList__Root
        ref={ref}
        role="group"
        aria-label={`${ariaLabel}: ${summary}`}
        data-mode={mode}
        data-density="badge"
        $row={false}
      >
        <InFlightList__Row $phase={worst ? "overdue" : "in-transit"}>
          <InFlightList__Arrow aria-hidden="true" $pulse={!worst}>
            ↑
          </InFlightList__Arrow>
          <InFlightList__Phase>
            {items.length}
            {countdown !== null && (
              <>
                {" · "}
                <Countdown value={Math.max(0, countdown)} />
              </>
            )}
          </InFlightList__Phase>
        </InFlightList__Row>
      </InFlightList__Root>
    </Tooltip>
  );
};

function InFlightRow({
  item,
  $compact,
}: {
  item: InFlightListItem;
  $compact: boolean;
}) {
  const countdown = useCountdown(item.etaSeconds);
  const isError = ERROR_PHASES.has(item.phase);
  const spoken =
    countdown === null
      ? `${item.label}, ${wordOf(item)}`
      : `${item.label}, ${clampedCountdown(countdown)}`;
  return (
    // Compact drops the visible label, so the row carries it as its accessible name; `title` is only a convenience.
    <InFlightList__Row
      $phase={item.phase}
      role="listitem"
      {...($compact ? { "aria-label": spoken, title: spoken } : {})}
    >
      <InFlightList__Arrow
        aria-hidden="true"
        $pulse={!isError}
        $inherit={isError}
      >
        {arrowOf(item)}
      </InFlightList__Arrow>
      {!$compact && <InFlightList__Label>{item.label}</InFlightList__Label>}
      <InFlightList__Phase>
        {countdown === null ? (
          wordOf(item)
        ) : (
          <Countdown value={Math.max(0, countdown)} />
        )}
      </InFlightList__Phase>
    </InFlightList__Row>
  );
}

const settleOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const InFlightRailStrip__Track = styled.div`
  position: relative;
  display: block;
  width: 100%;
  height: 16px;
  /* Clips the part of each dot above the strip, whatever box holds it. */
  overflow: hidden;
`;

/*
 * The opened rail's marks: whole dots, one lane per command, the first at the
 * middle of the height and each next one a lane below, then above, and so on.
 * Each drops in from the top edge, where the closed rail drew its tip.
 */
const LANE_GAP_PX = 14;

function laneTop(index: number, count: number, height: number): number {
  const gap = Math.min(
    LANE_GAP_PX,
    (height - RAIL_DOT_PX) / Math.max(1, count),
  );
  const step = Math.ceil(index / 2) * (index % 2 === 1 ? 1 : -1);
  const centre = height / 2 + step * gap;
  return Math.max(0, Math.min(height - RAIL_DOT_PX, centre - RAIL_DOT_PX / 2));
}

/**
 * The commands on the opened delay rail, as whole dots in lanes down a box of
 * `height` pixels, placed along it as the closed rail's marks are. Used by the
 * panel delay rail.
 */
export function InFlightLanes({
  items,
  height,
}: {
  items: InFlightListItem[];
  height: number;
}) {
  return (
    <InFlightLanes__Box
      role="group"
      aria-label="Commands on the rail"
      style={{ height }}
    >
      {items.map((item, index) => {
        const progress = Math.max(
          0,
          Math.min(1, item.progress ?? PHASE_PROGRESS[item.phase]),
        );
        // A dot names its command on hover, in the words its queue square uses.
        return (
          <Tooltip
            key={item.id}
            text={item.settling ? null : `${item.label}, ${wordOf(item)}`}
            announce={false}
            focusable={!item.settling}
          >
            <InFlightRailStrip__Dot
              {...(item.settling
                ? {
                    "data-role": "settling",
                    "data-settling": item.settling,
                    "aria-hidden": true,
                  }
                : {
                    role: "img",
                    "aria-label": `${item.label}, ${wordOf(item)}`,
                    "data-role": "glow",
                    "data-phase": item.phase,
                    ...(item.held ? { "data-held": "" } : {}),
                  })}
              data-lane={index}
              $settling={item.settling}
              $lane
              style={
                {
                  "--dot-colour": markColour(item),
                  "--dot-progress": progress,
                  "--settle-seconds": item.settleSeconds ?? 0,
                  "--lane-top": `${laneTop(index, items.length, height)}px`,
                } as CSSProperties
              }
            />
          </Tooltip>
        );
      })}
    </InFlightLanes__Box>
  );
}

/** A command's colour: the warning tone when held, unanswered or failed, so it is never invisible, the accent otherwise. */
function markColour(item: InFlightListItem): string {
  // An answered command is confirmed, however late its reply came.
  if (item.settling === "confirmed") return "var(--color-accent-fg)";
  return item.held || item.settling === "failed" || ERROR_PHASES.has(item.phase)
    ? TONE_MARK.warn
    : "var(--color-accent-fg)";
}

/*
 * A confirmed command glides on to the end over its settle time, then fades; a
 * failed one fades where it is.
 */
const settleMotion = (settling: InFlightListItem["settling"]) =>
  settling === "confirmed"
    ? css`
        transition: left var(--settle-time) var(--ease-linear);
        animation: ${settleOut} ${SETTLE_FADE_MS}ms var(--ease-standard) var(--settle-time) forwards;
      `
    : settling === "failed"
      ? css`
          animation: ${settleOut} ${SETTLE_FADE_MS}ms var(--ease-standard) forwards;
        `
      : null;

const dropIn = keyframes`
  from { top: ${-RAIL_DOT_PX * (1 - RAIL_DOT_SHOWN)}px; }
  to { top: var(--lane-top); }
`;

const InFlightLanes__Box = styled.div`
  position: relative;
  width: 100%;
  overflow: hidden;
`;

const InFlightRailStrip__Dot = styled.span<{
  $settling: InFlightListItem["settling"];
  $lane?: boolean;
}>`
  position: absolute;
  /* The settle time arrives as a bare count of seconds. */
  --settle-time: calc(var(--settle-seconds, 0) * 1000ms);
  top: ${-RAIL_DOT_PX * (1 - RAIL_DOT_SHOWN)}px;
  /* The dot's own width is kept inside the strip, so it is whole at both ends. */
  left: calc((100% - ${RAIL_DOT_PX}px) * var(--dot-progress));
  width: ${RAIL_DOT_PX}px;
  height: ${RAIL_DOT_PX}px;
  border-radius: var(--radius-circle);
  background: var(--dot-colour);
  box-shadow:
    0 0 6px 2px color-mix(in srgb, var(--dot-colour) 60%, transparent),
    0 0 14px 4px color-mix(in srgb, var(--dot-colour) 25%, transparent);

  ${({ $lane, $settling }) =>
    $lane &&
    css`
      top: var(--lane-top);
      /* A hover target a little larger than the dot, so its name is easy to find. */
      pointer-events: ${$settling ? "none" : "auto"};
      &::before {
        content: "";
        position: absolute;
        inset: -4px;
      }
    `}

  @media (prefers-reduced-motion: no-preference) {
    transition: left var(--duration-slow) var(--ease-linear);
    ${({ $settling }) => settleMotion($settling)}
    ${({ $lane, $settling }) =>
      $lane &&
      !$settling &&
      css`
        animation: ${dropIn} var(--duration-base) var(--ease-entrance);
      `}
  }
`;

/*
 * The expanded command queue: a SQUARE per command showing its own glyph,
 * never a status icon. Phase is colour, progress a thin bar, full when the
 * reply lands. One box for every command on the panel, which never grows the
 * widget: a queue longer than the box scrolls. A row in a wide box, a column
 * in a narrow one. An unanswered (lost or overdue) square is a clear button.
 */
const QUEUE_THICK = 54; // px
const QUEUE_BAR = 5;
const QUEUE_GAP = 3;
const QUEUE_SQUARE = QUEUE_THICK - 8 - QUEUE_BAR; // less border+padding and bar
const QUEUE_ROW_MIN = 60; // container width at/above which the queue runs as a row

const QUEUE_COLOUR: Record<InFlightListItem["phase"], string> = {
  "in-transit": "var(--color-accent-fg)",
  "awaiting-reply": "var(--color-accent-fg)",
  due: "var(--color-accent-fg)",
  overdue: TONE_MARK.warn,
  lost: TONE_MARK.warn,
};

function InFlightQueue({
  items,
  "aria-label": ariaLabel,
  onDismiss,
}: {
  items: InFlightListItem[];
  "aria-label": string;
  onDismiss?: (id: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const overflow = useInlineOverflow(scroller);
  // A row longer than its box scrolls sideways, and only then takes keyboard focus to be scrolled.
  const scrolls = overflow.left || overflow.right;
  return (
    <InFlightQueue__Box data-command-list="">
      <InFlightQueue__Inner
        ref={setScroller}
        role="list"
        aria-label={ariaLabel}
        {...(scrolls ? { tabIndex: 0, "data-scrolls": "" } : {})}
      >
        {items.map((item) => (
          <InFlightQueueCmd key={item.id} item={item} onDismiss={onDismiss} />
        ))}
      </InFlightQueue__Inner>
      <InlineOverflowGlow $position="left" $visible={overflow.left} />
      <InlineOverflowGlow $position="right" $visible={overflow.right} />
    </InFlightQueue__Box>
  );
}

function InFlightQueueCmd({
  item,
  onDismiss,
}: {
  item: InFlightListItem;
  onDismiss?: (id: string) => void;
}) {
  const glyph = item.glyph ?? deriveGlyph(item.label);
  const colour =
    item.settling === "confirmed"
      ? QUEUE_COLOUR["awaiting-reply"]
      : item.held || item.settling === "failed"
        ? TONE_MARK.warn
        : QUEUE_COLOUR[item.phase];
  // The bar is full when the reply lands, at two thirds; the last third is the rail's confirmed stage.
  const progress = Math.max(
    0,
    Math.min(1, (item.progress ?? PHASE_PROGRESS[item.phase]) * 1.5),
  );
  const dismissable =
    ERROR_PHASES.has(item.phase) && !!onDismiss && !item.settling;
  const spoken = `${item.label}, ${wordOf(item)}`;
  return (
    <InFlightQueue__Cmd
      role="listitem"
      aria-label={spoken}
      {...(item.settling
        ? { "data-settling": item.settling, "aria-hidden": true }
        : {
            "data-phase": item.phase,
            ...(item.held ? { "data-held": "" } : {}),
          })}
      $settling={item.settling}
      style={
        {
          color: colour,
          "--settle-seconds": item.settleSeconds ?? 0,
        } as CSSProperties
      }
    >
      <Tooltip
        text={dismissable ? `Dismiss ${item.label}` : spoken}
        announce={false}
      >
        <InFlightQueue__Sq
          as={dismissable ? "button" : "div"}
          {...(dismissable
            ? {
                type: "button" as const,
                "data-dismiss": "",
                onClick: (event: MouseEvent<HTMLElement>) => {
                  focusBesideDismissed(event.currentTarget);
                  onDismiss?.(item.id);
                },
                "aria-label": `Dismiss ${item.label}`,
              }
            : { "aria-hidden": true })}
        >
          <span className="glyph" aria-hidden="true">
            {glyph}
          </span>
          {dismissable && (
            <span className="dismiss" aria-hidden="true">
              ✕
            </span>
          )}
        </InFlightQueue__Sq>
      </Tooltip>
      <InFlightQueue__Bar>
        <span
          className="fill"
          style={{ "--fill-ratio": progress } as CSSProperties}
        />
      </InFlightQueue__Bar>
    </InFlightQueue__Cmd>
  );
}

const InFlightQueue__Box = styled.div.attrs({ role: "group" })`
  container-type: inline-size;
  /* Never shrinks in the rail's flex column, so a combined pinned rail shows the whole tile row. */
  flex: 0 0 auto;
  /* The row container the tiles sit in; its horizontal inset matches the standard content margin. */
  margin: var(--outset-command-strip);
  /* The inset equals (panel radius - tile radius), so the first tile's corner nests concentrically in the panel's. */
  --queue-panel-radius: calc(var(--radius-floating) * 2);
  --queue-tile-inset: calc(var(--queue-panel-radius) - var(--radius-regular));
  padding: var(--queue-tile-inset);
  height: calc(
    ${QUEUE_SQUARE}px + ${QUEUE_BAR}px + (var(--queue-tile-inset) * 2)
  );
  border-radius: var(--queue-panel-radius);
  background: color-mix(in srgb, var(--color-surface-raised) 68%, transparent);
  backdrop-filter: blur(6px);
  overflow: hidden;
  /* Holds the overflow glows over the row's edges. */
  position: relative;
`;

/* One row, one row high however many commands are in it; it scrolls sideways, its edge glows showing there is more. */
const InFlightQueue__Inner = styled.div`
  display: flex;
  flex-direction: row;
  /* Centred on the cross axis so both margins match; the main axis fills from the start, so a short queue reads as started. */
  align-items: center;
  justify-content: flex-start;
  gap: ${QUEUE_GAP}px;
  width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  /* Native scrollbar hidden: the edge glows show scroll state. */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }

  ${focusRingInset}
`;

const InFlightQueue__Cmd = styled.div<{
  $settling: InFlightListItem["settling"];
}>`
  /* The settle time arrives as a bare count of seconds. */
  --settle-time: calc(var(--settle-seconds, 0) * 1000ms);
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  min-width: 0;
  min-height: 0;

  @media (prefers-reduced-motion: no-preference) {
    ${({ $settling }) =>
      $settling === "confirmed"
        ? css`
            animation: ${settleOut} ${SETTLE_FADE_MS}ms var(--ease-standard)
              var(--settle-time) forwards;
            .fill {
              transition:
                height var(--settle-time) var(--ease-linear),
                width var(--settle-time) var(--ease-linear);
            }
          `
        : $settling === "failed"
          ? css`
              animation: ${settleOut} ${SETTLE_FADE_MS}ms var(--ease-standard) forwards;
            `
          : null}
  }

  @container (min-width: ${QUEUE_ROW_MIN}px) {
    flex-direction: column;
  }
`;

const InFlightQueue__Sq = styled.div`
  --s: ${QUEUE_SQUARE}px;
  flex: 0 0 var(--s);
  width: var(--s);
  height: var(--s);
  align-self: center;
  position: relative;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 0;
  appearance: none;
  font: inherit;
  font-size: var(--font-size-compact);
  font-weight: 700;
  color: currentColor;
  background: color-mix(in srgb, currentColor 10%, var(--color-surface-raised));
  border: 1px solid currentColor;
  border-right: 0;
  border-radius: var(--radius-regular) 0 0 var(--radius-regular);
  overflow: hidden;

  @container (min-width: ${QUEUE_ROW_MIN}px) {
    border-right: 1px solid currentColor;
    border-bottom: 0;
    border-radius: var(--radius-regular) var(--radius-regular) 0 0;
  }

  .glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-text-primary);
  }
  .dismiss {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: 0;
    background: color-mix(in srgb, currentColor 22%, var(--color-surface-sunken));
  }

  &:is(button) {
    cursor: pointer;
  }
  &:is(button):hover .dismiss,
  &:is(button):focus-visible .dismiss {
    opacity: 1;
  }
  &:is(button):hover .glyph,
  &:is(button):focus-visible .glyph {
    opacity: 0;
  }
  /* Not the kit's shared ring: every other part of the tile follows the phase colour through currentColor. */
  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 1px;
  }
`;

const InFlightQueue__Bar = styled.div`
  --s: ${QUEUE_SQUARE}px;
  position: relative;
  flex: 0 0 ${QUEUE_BAR}px;
  width: ${QUEUE_BAR}px;
  height: var(--s);
  overflow: hidden;
  background: var(--color-surface-panel);
  border: 1px solid currentColor;
  border-radius: 0 var(--radius-regular) var(--radius-regular) 0;

  @container (min-width: ${QUEUE_ROW_MIN}px) {
    width: var(--s);
    height: ${QUEUE_BAR}px;
    border-radius: 0 0 var(--radius-regular) var(--radius-regular);
  }

  .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--fill-ratio, 0) * 100%);
    background: currentColor;
  }
  @container (min-width: ${QUEUE_ROW_MIN}px) {
    .fill {
      top: 0;
      bottom: 0;
      left: 0;
      right: auto;
      width: calc(var(--fill-ratio, 0) * 100%);
      height: auto;
    }
  }
`;

const InFlightList__Root = styled.div<{ $row: boolean }>`
  flex: 0 0 auto;
  display: flex;
  flex-direction: ${({ $row }) => ($row ? "row" : "column")};
  flex-wrap: ${({ $row }) => ($row ? "wrap" : "nowrap")};
  column-gap: var(--gap-command-list-column);
  gap: var(--gap-command-list-row);
  padding: var(--inset-command-list);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

const PHASE_ROW_STYLES: Record<
  InFlightListItem["phase"],
  ReturnType<typeof css>
> = {
  "in-transit": css`
    color: var(--color-text-primary);
  `,
  "awaiting-reply": css`
    color: var(--color-text-muted);
  `,
  due: css`
    color: var(--color-text-muted);
  `,
  overdue: css`
    color: ${TONE_TEXT.warn};
  `,
  lost: css`
    color: ${TONE_TEXT.warn};
  `,
};

const InFlightList__Row = styled.div<{ $phase: InFlightListItem["phase"] }>`
  display: flex;
  align-items: baseline;
  gap: var(--gap-command-row);

  ${({ $phase }) => PHASE_ROW_STYLES[$phase]}
`;

/** `$inherit` draws the glyph in its row's colour, so an unanswered entry's mark carries its tone. */
const InFlightList__Arrow = styled.span<{
  $pulse: boolean;
  $inherit?: boolean;
}>`
  flex: 0 0 auto;
  color: ${({ $inherit }) => ($inherit ? "inherit" : "var(--color-accent-fg)")};

  ${({ $pulse }) =>
    $pulse &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: in-flight-list-pulse 1.6s var(--ease-emphasis) infinite;
      }
    `}

  @keyframes in-flight-list-pulse {
    50% {
      opacity: 0.35;
    }
  }
`;

const InFlightList__Label = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const InFlightList__Phase = styled.span`
  flex: 0 0 auto;
`;
