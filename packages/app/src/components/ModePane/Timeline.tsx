import type { ModeTimeline } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { useEvents } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  IconButton,
  Select,
  Slider,
  Tooltip,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { layoutMarks } from "./markLayout";

/** The Timeline's height, which the pane's rule turns along and the dashboard keeps clear of. */
export const TIMELINE_HEIGHT_PX = 64;

/** The Timeline's height on a phone, where the slider and its marks take a row of their own above the times and controls. */
export const TIMELINE_COMPACT_PX = 112;

const duration = (seconds: number) =>
  writeQuantity(value("s", Math.max(0, seconds)));

/**
 * The mode's Timeline: the moment every tile in the mode shows, moved by
 * dragging, by a mark, or by playing a recording back. It reads and moves the
 * mode's own clock through `timeline`, so every widget in the mode answers at
 * that moment. With no timeline it shows `empty` alone.
 */
export function Timeline({
  timeline,
  empty,
  compact = false,
  subject = "replay",
  leading,
  trailing,
  notice,
}: {
  timeline: ModeTimeline | undefined;
  empty?: string;
  /** On a phone: the slider and its marks take a row of their own above the times and controls. */
  compact?: boolean;
  /** What plays, in the words its controls name it by, such as "burn preview". */
  subject?: string;
  /** A control ahead of the Timeline's own, such as the one that shows a minimised pane again. */
  leading?: ReactNode;
  /** A control after the Timeline's own, such as a station's sync switch. */
  trailing?: ReactNode;
  /** A word on the mode's state, drawn under the track at its right end, where it takes no width from the slider. */
  notice?: ReactNode;
}) {
  if (!timeline) {
    return (
      <Timeline__Bar>
        {leading}
        <Timeline__Empty>{empty}</Timeline__Empty>
        {trailing}
      </Timeline__Bar>
    );
  }
  const { start, end, at, launchUt, playback } = timeline;
  const zero = launchUt ?? start;
  const clock = (ut: number) =>
    launchUt === undefined ? duration(ut - zero) : `T+${duration(ut - zero)}`;
  const span = Math.max(end - start, 1);
  return (
    <Timeline__Bar data-compact={compact}>
      {leading}
      {playback ? (
        <IconButton
          type="button"
          aria-label={playback.playing ? `Pause ${subject}` : `Play ${subject}`}
          onClick={() =>
            playback.playing ? playback.pause() : playback.play()
          }
        >
          {playback.playing ? "❚❚" : "▶"}
        </IconButton>
      ) : null}
      <Timeline__Now aria-live="off">{clock(at)}</Timeline__Now>
      <Timeline__Track data-track>
        <Events timeline={timeline} span={span} notice={notice} />
      </Timeline__Track>
      <Timeline__End>{clock(end)}</Timeline__End>
      {playback ? (
        <>
          <Timeline__Rate
            aria-label="Playback rate"
            value={String(playback.rate)}
            onChange={(e) => playback.setRate(Number(e.currentTarget.value))}
          >
            {playback.rates.map((r) => (
              <option key={r} value={String(r)}>
                {`${r}×`}
              </option>
            ))}
          </Timeline__Rate>
          <Tooltip text={`Exit ${subject}`}>
            <IconButton
              type="button"
              aria-label={`Exit ${subject} and return to live data`}
              onClick={playback.exit}
            >
              ✕
            </IconButton>
          </Tooltip>
        </>
      ) : null}
      {trailing}
    </Timeline__Bar>
  );
}

const MARK_GAP_PX = 4;
/** How far an event may fall from a mark of the same name and still be that mark's event, in seconds. */
const SAME_EVENT_SECONDS = 5;
/** The height the leaders have between the track and the labels. */
const LEADER_PX = 9;
/** The width of the slider's thumb, whose centre is the moment the slider shows: it travels the track less half of this at each end. */
const THUMB_PX = 16;

/**
 * The Timeline's slider with its events: the moments the mode marks and each
 * stage the craft fired in the Timeline's stretch, the same events Ground
 * Track ticks. Each is a short bar across the track that says what happened
 * on hover or focus and moves the Timeline to its moment when pressed. Each
 * is also labelled under the track while every label fits there.
 */
function Events({
  timeline,
  span,
  notice,
}: {
  timeline: ModeTimeline;
  span: number;
  notice?: ReactNode;
}) {
  const { start, end, at, marks } = timeline;
  const id = useId();
  const happened = useEvents(start, end);
  /*
   * The list is the same list for as long as it holds the same events: the
   * marks and the events arrive as new arrays with each render, and a list
   * that changed with them would have the labels measured again every time.
   */
  const seen = new Set<string>();
  const own = new Set(marks ?? []);
  const found = [...(marks ?? []), ...happened]
    .filter((e) => {
      // A mode's marks are among the events while the mod holds its timeline, so each is taken once.
      const key = `${e.ut}:${e.label}`;
      if (e.ut < start || e.ut > end || seen.has(key)) return false;
      // A stage this timeline marks itself is that mark's event, though the craft's sample of it comes a moment later.
      if (
        !own.has(e) &&
        [...own].some(
          (m) =>
            m.label === e.label && Math.abs(m.ut - e.ut) <= SAME_EVENT_SECONDS,
        )
      ) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.ut - b.ut);
  const same = [...seen].sort().join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `same` names every event in `found`
  const events = useMemo(() => found, [same]);
  const row = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<
    | {
        fits: boolean;
        labels: readonly { left: number; centre: number; at: number }[];
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const total = el.clientWidth;
      const widths = Array.from(
        el.querySelectorAll<HTMLElement>("[data-mark]"),
      ).map((l) => l.offsetWidth);
      const moments = events.map(
        (e) => THUMB_PX / 2 + ((e.ut - start) / span) * (total - THUMB_PX),
      );
      const needed =
        widths.reduce((sum, w) => sum + w, 0) +
        MARK_GAP_PX * Math.max(widths.length - 1, 0);
      const labels = layoutMarks(moments, widths, total, MARK_GAP_PX).map(
        (left, i) => ({
          left,
          centre: left + (widths[i] ?? 0) / 2,
          at: moments[i] ?? 0,
        }),
      );
      const fits = needed <= total;
      setPlaced((prev) =>
        prev?.fits === fits &&
        prev.labels.length === labels.length &&
        prev.labels.every(
          (v, i) => v.left === labels[i]?.left && v.at === labels[i]?.at,
        )
          ? prev
          : { fits, labels },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [events, start, span]);
  const fits = placed?.fits ?? true;
  return (
    <>
      <Timeline__Slider>
        <Slider
          aria-label="Timeline"
          min={start}
          max={end}
          step={0.1}
          value={at}
          onChange={(e) => timeline.seek(Number(e.currentTarget.value))}
        />
        {events.map((event, i) => (
          <Tooltip
            key={`${event.ut}:${event.label}`}
            text={event.label}
            announce={false}
          >
            <Timeline__Event
              type="button"
              id={`${id}-${i}`}
              aria-label={event.label}
              data-timeline-event={event.label}
              style={{
                left: `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${(event.ut - start) / span})`,
              }}
              onClick={() => timeline.seek(event.ut)}
            />
          </Tooltip>
        ))}
      </Timeline__Slider>
      {events.length > 0 || notice ? (
        <Timeline__Under>
          {events.length > 0 ? (
            <Timeline__Marks
              ref={row}
              data-fits={fits}
              style={fits ? undefined : { visibility: "hidden" }}
            >
              {/* A leader from each event's own moment on the track to its label, so a label moved aside still reads as that moment's. */}
              {placed ? (
                <Timeline__Leaders aria-hidden>
                  {placed.labels.map((p, i) => (
                    <line
                      key={`${events[i]?.label}-${events[i]?.ut}`}
                      x1={p.at}
                      y1={0}
                      x2={p.centre}
                      y2={LEADER_PX}
                    />
                  ))}
                </Timeline__Leaders>
              ) : null}
              {events.map((event, i) => (
                // Pressing a label presses its event's bar on the track, which is the control.
                <Timeline__Mark
                  key={`${event.label}-${event.ut}`}
                  data-mark
                  htmlFor={`${id}-${i}`}
                  style={
                    placed?.labels[i] === undefined
                      ? {
                          left: `${((event.ut - start) / span) * 100}%`,
                          transform: "translateX(-50%)",
                        }
                      : { left: placed.labels[i].left }
                  }
                >
                  {event.label}
                </Timeline__Mark>
              ))}
            </Timeline__Marks>
          ) : null}
          {notice ? <Timeline__Notice>{notice}</Timeline__Notice> : null}
        </Timeline__Under>
      ) : null}
    </>
  );
}

const Timeline__Bar = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related-comfortable);
  height: 100%;
  padding: var(--inset-frame-panel);
  min-width: 0;
  &[data-compact="true"] {
    flex-wrap: wrap;
    align-content: center;
    justify-content: space-between;
    row-gap: var(--gap-related-compact);
  }
  &[data-compact="true"] > [data-track] {
    order: -1;
    flex-basis: 100%;
  }
`;

const Timeline__Empty = styled.span`
  color: var(--color-text-muted);
`;

const Timeline__Now = styled.span`
  flex: none;
  min-width: 11ch;
  color: var(--color-text-primary);
`;

const Timeline__End = styled.span`
  flex: none;
  color: var(--color-text-muted);
`;

/*
 * The slider alone takes the mode's colour. It is set here and not on the
 * whole row, because the row also holds controls with colours of their own:
 * a switch drawn in the mode's colour loses its knob when that colour is the
 * one the switch already uses for "on".
 */
const Timeline__Track = styled.div`
  --color-accent-fg: var(--mode-rule);
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-dense);
`;

const Timeline__Slider = styled.div`
  position: relative;
  display: flex;
`;

/* The bar is drawn inside a target wide enough to press, and stands across the slider's track. */
const Timeline__Event = styled.button`
  position: absolute;
  top: 50%;
  width: 12px;
  height: 20px;
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  border-radius: var(--radius-regular);
  background: none;
  cursor: pointer;
  &::before {
    content: "";
    position: absolute;
    left: 5px;
    top: 2px;
    width: 2px;
    height: 16px;
    background: var(--color-text-primary);
  }
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const Timeline__Marks = styled.div`
  position: relative;
  height: calc(${LEADER_PX}px + 1.6em);
`;

/** The row under the track: the marks, with a notice laid over its right end. */
const Timeline__Under = styled.div`
  position: relative;
  min-height: calc(${LEADER_PX}px + 1.6em);
`;

const Timeline__Notice = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  pointer-events: none;
`;

const Timeline__Leaders = styled.svg`
  position: absolute;
  inset: 0 0 auto 0;
  width: 100%;
  height: ${LEADER_PX}px;
  overflow: visible;
  pointer-events: none;
  & line {
    stroke: var(--color-text-muted);
    stroke-width: 1;
  }
`;

const Timeline__Mark = styled.label`
  position: absolute;
  top: ${LEADER_PX}px;
  white-space: nowrap;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  padding: var(--inset-chip);
`;

const Timeline__Rate = styled(Select)`
  flex: none;
  width: auto;
`;
