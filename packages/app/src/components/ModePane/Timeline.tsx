import type { ModeTimeline } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  IconButton,
  Select,
  Slider,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

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
}: {
  timeline: ModeTimeline | undefined;
  empty?: string;
  /** On a phone: the slider and its marks take a row of their own above the times and controls. */
  compact?: boolean;
}) {
  if (!timeline) {
    return (
      <Timeline__Bar>
        <Timeline__Empty>{empty}</Timeline__Empty>
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
      {playback ? (
        <IconButton
          type="button"
          aria-label={playback.playing ? "Pause replay" : "Play replay"}
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
        {timeline.marks && timeline.marks.length > 0 ? (
          <Timeline__Marks aria-label="Marks">
            {timeline.marks.map((m) => (
              <Timeline__Mark
                key={`${m.label}-${m.ut}`}
                type="button"
                style={{ left: `${((m.ut - start) / span) * 100}%` }}
                onClick={() => timeline.seek(m.ut)}
              >
                {m.label}
              </Timeline__Mark>
            ))}
          </Timeline__Marks>
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
          <Button
            variant="ghost"
            aria-label="Exit replay and return to live data"
            onClick={playback.exit}
          >
            Exit replay
          </Button>
        </>
      ) : null}
    </Timeline__Bar>
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

const Timeline__Track = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-dense);
`;

const Timeline__Marks = styled.div`
  position: relative;
  height: 1.6em;
`;

const Timeline__Mark = styled.button`
  position: absolute;
  transform: translateX(-50%);
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
