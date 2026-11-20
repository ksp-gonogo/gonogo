import type { ModeTimeline } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { IconButton, Select, Slider, writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type ReactNode,
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
        <Slider
          aria-label="Timeline"
          min={start}
          max={end}
          step={0.1}
          value={at}
          onChange={(e) => timeline.seek(Number(e.currentTarget.value))}
        />
        {(timeline.marks && timeline.marks.length > 0) || notice ? (
          <Timeline__Under>
            {timeline.marks && timeline.marks.length > 0 ? (
              <Marks
                marks={timeline.marks}
                start={start}
                span={span}
                onSeek={timeline.seek}
              />
            ) : null}
            {notice ? <Timeline__Notice>{notice}</Timeline__Notice> : null}
          </Timeline__Under>
        ) : null}
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
          <IconButton
            type="button"
            aria-label={`Exit ${subject} and return to live data`}
            title={`Exit ${subject}`}
            onClick={playback.exit}
          >
            ✕
          </IconButton>
        </>
      ) : null}
      {trailing}
    </Timeline__Bar>
  );
}

const MARK_GAP_PX = 4;
/** The height the leaders have between the track and the labels. */
const LEADER_PX = 9;

/**
 * The Timeline's marks: a label for each, joined by a leader to its moment on
 * the track. Labels that fall close together are moved apart so each can be
 * read and pressed, and each still seeks to its own moment.
 */
function Marks({
  marks,
  start,
  span,
  onSeek,
}: {
  marks: NonNullable<ModeTimeline["marks"]>;
  start: number;
  span: number;
  onSeek: (ut: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<
    readonly { left: number; centre: number; at: number }[] | undefined
  >(undefined);
  const ordered = useMemo(
    () => [...marks].sort((a, b) => a.ut - b.ut),
    [marks],
  );
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const total = el.clientWidth;
      const widths = Array.from(
        el.querySelectorAll<HTMLElement>("[data-mark]"),
      ).map((l) => l.offsetWidth);
      const moments = ordered.map((m) => ((m.ut - start) / span) * total);
      const next = layoutMarks(moments, widths, total, MARK_GAP_PX).map(
        (left, i) => ({
          left,
          centre: left + (widths[i] ?? 0) / 2,
          at: moments[i] ?? 0,
        }),
      );
      setPlaced((prev) =>
        prev?.length === next.length &&
        prev.every((v, i) => v.left === next[i]?.left && v.at === next[i]?.at)
          ? prev
          : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ordered, start, span]);
  return (
    <Timeline__Marks ref={row} role="group" aria-label="Marks">
      {/* A leader from each mark's own moment on the track to its label, so a label moved aside still reads as that moment's. */}
      {placed ? (
        <Timeline__Leaders aria-hidden>
          {placed.map((p, i) => (
            <line
              key={`${ordered[i]?.label}-${ordered[i]?.ut}`}
              x1={p.at}
              y1={0}
              x2={p.centre}
              y2={LEADER_PX}
            />
          ))}
        </Timeline__Leaders>
      ) : null}
      {ordered.map((m, i) => (
        <Timeline__Mark
          key={`${m.label}-${m.ut}`}
          data-mark
          type="button"
          style={
            placed?.[i] === undefined
              ? {
                  left: `${((m.ut - start) / span) * 100}%`,
                  transform: "translateX(-50%)",
                }
              : { left: placed[i].left }
          }
          onClick={() => onSeek(m.ut)}
        >
          {m.label}
        </Timeline__Mark>
      ))}
    </Timeline__Marks>
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

const Timeline__Mark = styled.button`
  position: absolute;
  top: ${LEADER_PX}px;
  white-space: nowrap;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const Timeline__Rate = styled(Select)`
  flex: none;
  width: auto;
`;
