import { currentMode, value } from "@ksp-gonogo/sitrep-sdk";
import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";
import { Countdown } from "../Countdown";
import { writeQuantity } from "../units";
import { useElementSize } from "../useElementSize";
import { deriveGlyph, PHASE_PROGRESS } from "./toInFlightListItems";

/** Which ONE of the two delay readings a console draws. */
export type SignalDelayPresentation = "badge" | "strip" | "none";

export interface SignalDelayPresentationInput {
  /**
   * One-way separation in seconds, `null` when there is no measurable path.
   * Neither `null` nor a measured zero gets a badge.
   */
  oneWaySeconds: number | null;
  /**
   * Whether this console can put something in the strip. A read-only viewer
   * gets NEITHER reading at a long delay: no queue, and no cost it ever pays.
   */
  canQueue: boolean;
  /**
   * Force the badge whatever the magnitude, for a terminal in CHARACTER mode:
   * every keystroke goes on its own, so the strip has nothing to list.
   */
  alwaysBadge?: boolean;
}

/**
 * Which ONE of the two delay readings a console shows, given how far away the
 * other end is:
 *
 *   - a BADGE is a standing readout of the separation, useful before anything
 *     has been sent
 *   - a STRIP (`InFlightList`) is one row per thing actually crossing, useful
 *     once something is out
 *
 * They are MUTUALLY EXCLUSIVE: drawn together they say the same number twice
 * in two shapes. The boundary is `currentMode`'s, the same one the engine uses
 * to stage a dispatch rather than send it live.
 */
export function signalDelayPresentation({
  oneWaySeconds,
  canQueue,
  alwaysBadge = false,
}: SignalDelayPresentationInput): SignalDelayPresentation {
  if (oneWaySeconds === null || oneWaySeconds <= 0) return "none";
  if (alwaysBadge) return "badge";
  if (currentMode({ oneWaySeconds: value("s", oneWaySeconds) }) === "live") {
    return "badge";
  }
  return canQueue ? "strip" : "none";
}

/**
 * Display shape for one delayed command, declared locally. `etaSeconds` is the
 * caller's choice of clock (reach or reply); `null` renders as "no ETA" (an
 * `overdue` or `lost` entry, or `no-path` mode).
 */
export interface InFlightListItem {
  id: string;
  label: string;
  etaSeconds: number | null;
  phase: "in-transit" | "awaiting-reply" | "due" | "overdue" | "lost";
  /**
   * True position along the 3-stage delay axis, 0 (just sent) to 1 (end of the
   * 3T span). Only the `variant="rail"` glow reads it; without it the glow
   * anchors by phase.
   */
  progress?: number;
  /**
   * The command's OWN terse glyph ("PRO", "RET", "WARP"), shown in the
   * `variant="expanded"` queue square. Phase is conveyed by colour, never by
   * the glyph. Defaults to an abbreviation of `label`.
   */
  glyph?: string;
}

export type InFlightListMode = "live" | "staged" | "no-path";

/**
 * How much room the list gets to say what it knows. Orthogonal to `mode`,
 * which is about WHAT is being counted; this is about how much space there is
 * to count it in.
 *
 *   - `full`    arrow, label and countdown per command, one per line
 *   - `compact` arrow and countdown only; the label moves to the accessible
 *               name and tooltip
 *   - `badge`   one chip for the whole set: count plus the nearest arrival
 *
 * `auto` (the default) measures the rendered width and picks.
 */
export type InFlightListDensity = "auto" | "full" | "compact" | "badge";

export interface InFlightListProps {
  items: InFlightListItem[];
  mode?: InFlightListMode;
  density?: InFlightListDensity;
  /**
   * `column` stacks the entries, `row` flows them. A queue under a button
   * group wants a column; one beside an action row wants a row. Row wraps, so
   * it degrades to several short lines rather than overflowing.
   */
  orientation?: "column" | "row";
  /** Accessible label for the list region. Defaults to "In-flight commands". */
  ariaLabel?: string;
  /**
   * `"inline"` (default) is the monospace row/badge list. `"rail"` is the
   * Panel rail's 16px strip: each command is a soft glow grazing the top edge,
   * sweeping left to right by journey progress. `"expanded"` is the pinned
   * detail: a queue square per command. `mode`, `density` and `orientation`
   * apply to `"inline"` only.
   */
  variant?: "inline" | "rail" | "expanded";
  /**
   * Clear a dead command (`overdue`/`lost`) from the shared delay queue. When
   * given, the `"expanded"` queue's failed squares become real clear buttons.
   * Applies to `"expanded"` only.
   */
  onDismiss?: (id: string) => void;
}

const PHASE_ARROW: Record<InFlightListItem["phase"], string> = {
  "in-transit": "↑",
  "awaiting-reply": "↓",
  due: "↓",
  overdue: "!",
  lost: "✕",
};

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
 * The countdown a strip SPEAKS, for the accessible name and a row's `title`.
 * Clamped at zero: a strip shows time REMAINING, never a negative duration.
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

/** Re-seed the local countdown only on a jump this large (seconds): the caller's `etaSeconds` drifts by fractions on every re-render. */
const RESYNC_THRESHOLD_SECONDS = 1;

/**
 * A local-ticking countdown: seeds from `etaSeconds`, resyncs only on a real
 * jump, and otherwise decrements once per second on its own interval, so the
 * number stays smooth whatever the caller's cadence. Reads only the value
 * passed in.
 */
export function useCountdown(etaSeconds: number | null): number | null {
  const [value, setValue] = useState(etaSeconds);
  const lastSeedRef = useRef(etaSeconds);

  useEffect(() => {
    const last = lastSeedRef.current;
    const jumped =
      (last === null) !== (etaSeconds === null) ||
      (last !== null &&
        etaSeconds !== null &&
        Math.abs(etaSeconds - last) >= RESYNC_THRESHOLD_SECONDS);
    if (jumped) {
      lastSeedRef.current = etaSeconds;
      setValue(etaSeconds);
    }
  }, [etaSeconds]);

  // Mount-once and not keyed on `etaSeconds`, which drifts every render and would never let a full second elapse.
  useEffect(() => {
    const id = setInterval(() => {
      setValue((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return value;
}

/**
 * Presentational set-renderer for in-flight commands: rows with per-entry
 * countdowns and phase styling. Renders nothing for an empty set. No data
 * hooks; a widget feeds it `useCommand().inFlight` directly.
 */
export function InFlightList({
  items,
  mode,
  density = "auto",
  orientation = "column",
  ariaLabel = "In-flight commands",
  variant = "inline",
  onDismiss,
}: InFlightListProps) {
  // Seeded wide so `auto` only ever shrinks from the full form, never flashing a badge on mount.
  const { ref, size } = useElementSize({ w: 320, h: 0 });

  // The rail and expanded renderings bypass density entirely.
  if (variant === "rail") {
    if (items.length === 0) return null;
    return <InFlightRailStrip items={items} ariaLabel={ariaLabel} />;
  }
  if (variant === "expanded") {
    if (items.length === 0) return null;
    return (
      <InFlightQueue
        items={items}
        ariaLabel={ariaLabel}
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
        ariaLabel={ariaLabel}
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
 * Rail strip geometry: each command is a glow centred ABOVE the top edge, so
 * only its blur grazes the strip, with x tracking true journey progress. No
 * baseline or dividers.
 */
const RAIL_VB_W = 100;
const RAIL_VB_H = 16;
const GLOW_CY = -4;
const GLOW_R = 9;
const GLOW_PEAK_ALPHA = 0.22;

function InFlightRailStrip({
  items,
  ariaLabel,
}: {
  items: InFlightListItem[];
  ariaLabel: string;
}) {
  const gradBase = useId();
  const summary = `${items.length} in flight`;
  return (
    <InFlightRailStrip__Svg
      role="img"
      aria-label={`${ariaLabel}: ${summary}`}
      viewBox={`0 0 ${RAIL_VB_W} ${RAIL_VB_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        {items.map((item, i) => {
          // A failed command's glow goes amber (overdue) or red (lost), so a failure is never invisible here.
          const colour =
            item.phase === "lost"
              ? "var(--color-status-nogo-bg)"
              : item.phase === "overdue"
                ? "var(--color-status-warning-bg)"
                : "var(--color-accent-fg)";
          const progress = Math.max(
            0,
            Math.min(1, item.progress ?? PHASE_PROGRESS[item.phase]),
          );
          const cx = progress * RAIL_VB_W;
          return (
            <radialGradient
              key={item.id}
              id={`${gradBase}-${i}`}
              gradientUnits="userSpaceOnUse"
              cx={cx}
              cy={GLOW_CY}
              r={GLOW_R}
            >
              <stop
                offset="0"
                stopColor={colour}
                stopOpacity={GLOW_PEAK_ALPHA}
              />
              <stop offset="1" stopColor={colour} stopOpacity="0" />
            </radialGradient>
          );
        })}
      </defs>
      {items.map((item, i) => (
        <rect
          key={item.id}
          data-role="glow"
          data-phase={item.phase}
          x="0"
          y="0"
          width={RAIL_VB_W}
          height={RAIL_VB_H}
          fill={`url(#${gradBase}-${i})`}
        />
      ))}
    </InFlightRailStrip__Svg>
  );
}

/** The whole queue as one chip: how many are out, and when the next one arrives. */
const InFlightBadge = function InFlightBadge({
  ref,
  items,
  mode,
  ariaLabel,
}: {
  ref: RefObject<HTMLDivElement>;
  items: InFlightListItem[];
  mode?: InFlightListMode;
  ariaLabel: string;
}) {
  const countdown = useCountdown(nearestEta(items));
  const worst = items.some((i) => ERROR_PHASES.has(i.phase));
  const summary =
    countdown === null
      ? `${items.length} in flight`
      : `${items.length} in flight, next in ${clampedCountdown(countdown)}`;
  return (
    <InFlightList__Root
      ref={ref}
      role="group"
      aria-label={`${ariaLabel}: ${summary}`}
      data-mode={mode}
      data-density="badge"
      title={items.map((i) => i.label).join("\n")}
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
      ? `${item.label}, ${item.phase}`
      : `${item.label}, ${clampedCountdown(countdown)}`;
  return (
    // Compact drops the visible label, so the row carries it as its accessible name; `title` is only a convenience.
    <InFlightList__Row
      $phase={item.phase}
      role="listitem"
      {...($compact ? { "aria-label": spoken, title: spoken } : {})}
    >
      <InFlightList__Arrow aria-hidden="true" $pulse={!isError}>
        {PHASE_ARROW[item.phase]}
      </InFlightList__Arrow>
      {!$compact && <InFlightList__Label>{item.label}</InFlightList__Label>}
      <InFlightList__Phase>
        {countdown === null ? (
          item.phase
        ) : (
          <Countdown value={Math.max(0, countdown)} />
        )}
      </InFlightList__Phase>
    </InFlightList__Row>
  );
}

const InFlightRailStrip__Svg = styled.svg`
  display: block;
  width: 100%;
  height: 16px;
`;

/*
 * The expanded command queue: a SQUARE per command showing its own glyph,
 * never a status icon. Phase is colour, progress a thin bar. A fixed box that
 * never grows the widget: overflow becomes a `+N` count, never a scroll. A row
 * in a wide box, a column in a narrow one. A lost or overdue square is a clear
 * button.
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
  overdue: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

function InFlightQueue({
  items,
  ariaLabel,
  onDismiss,
}: {
  items: InFlightListItem[];
  ariaLabel: string;
  onDismiss?: (id: string) => void;
}) {
  const { ref, size } = useElementSize({ w: 320, h: QUEUE_THICK });
  // Capacity is measured on the main axis, so a full queue caps at `+N` rather than scrolling.
  const row = size.w >= QUEUE_ROW_MIN;
  const main = row ? size.w : size.h;
  const capacity = Math.max(
    1,
    Math.floor((main - 6) / (QUEUE_SQUARE + QUEUE_GAP)),
  );
  const willOverflow = items.length > capacity;
  const shown = willOverflow ? items.slice(0, capacity - 1) : items;
  const hidden = items.length - shown.length;
  return (
    <InFlightQueue__Box ref={ref}>
      <InFlightQueue__Inner role="list" aria-label={ariaLabel}>
        {shown.map((item) => (
          <InFlightQueueCmd key={item.id} item={item} onDismiss={onDismiss} />
        ))}
        {hidden > 0 && (
          <InFlightQueue__Overflow
            role="listitem"
            aria-label={`${hidden} more in flight`}
          >
            +{hidden}
          </InFlightQueue__Overflow>
        )}
      </InFlightQueue__Inner>
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
  const colour = QUEUE_COLOUR[item.phase];
  const progress = Math.max(
    0,
    Math.min(1, item.progress ?? PHASE_PROGRESS[item.phase]),
  );
  const failed = item.phase === "overdue" || item.phase === "lost";
  const dismissable = failed && !!onDismiss;
  const spoken = `${item.label}, ${item.phase}`;
  return (
    <InFlightQueue__Cmd
      role="listitem"
      aria-label={spoken}
      data-phase={item.phase}
      style={{ color: colour }}
    >
      <InFlightQueue__Sq
        as={dismissable ? "button" : "div"}
        {...(dismissable
          ? {
              type: "button" as const,
              onClick: () => onDismiss?.(item.id),
              "aria-label": `Dismiss ${item.label}`,
            }
          : { "aria-hidden": true })}
        title={dismissable ? `Dismiss ${item.label}` : spoken}
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
`;

const InFlightQueue__Inner = styled.div`
  display: flex;
  flex-direction: column;
  /* Centred on the cross axis so both margins match; the main axis fills from the start, so a short queue reads as started. */
  align-items: center;
  justify-content: flex-start;
  gap: ${QUEUE_GAP}px;
  width: 100%;
  height: 100%;

  @container (min-width: ${QUEUE_ROW_MIN}px) {
    flex-direction: row;
  }
`;

const InFlightQueue__Cmd = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  min-width: 0;
  min-height: 0;

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

const InFlightQueue__Overflow = styled.span`
  align-self: center;
  flex: 0 0 auto;
  padding: 0 ${QUEUE_GAP}px;
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
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
    color: var(--color-status-warning-fg-muted);
  `,
  lost: css`
    color: var(--color-status-nogo-fg);
  `,
};

const InFlightList__Row = styled.div<{ $phase: InFlightListItem["phase"] }>`
  display: flex;
  align-items: baseline;
  gap: var(--gap-command-row);

  ${({ $phase }) => PHASE_ROW_STYLES[$phase]}
`;

const InFlightList__Arrow = styled.span<{ $pulse: boolean }>`
  flex: 0 0 auto;
  color: var(--color-accent-fg);

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
  color: inherit;
  opacity: 0.85;
`;
