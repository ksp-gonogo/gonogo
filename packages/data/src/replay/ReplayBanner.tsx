import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  getReplayController,
  type ReplayControllerState,
} from "./ReplayController";

/**
 * Sticky banner shown across the top of the screen while replay is
 * active. Renders nothing when idle, so callers can mount it
 * unconditionally at the app shell level.
 *
 * Controls: play/pause, draggable seek bar, chapter quick-jump, rate
 * selector, exit. Fires through `getReplayController()` — no wiring
 * needed at the call site.
 */
export function ReplayBanner() {
  const controller = getReplayController();
  const [state, setState] = useState<ReplayControllerState>(
    controller.getState(),
  );

  useEffect(() => controller.subscribe(setState), [controller]);

  if (!state.active || !state.flight) return null;

  return (
    <Bar role="region" aria-label="Replay controls">
      <Section>
        <PlayButton
          type="button"
          onClick={() => controller.togglePlay()}
          aria-label={state.playing ? "Pause replay" : "Play replay"}
        >
          {state.playing ? "❚❚" : "▶"}
        </PlayButton>
        <Title>
          REPLAY: <Strong>{state.flight.vesselName}</Strong>
        </Title>
      </Section>

      <SeekArea>
        <TimeText>{formatElapsed(state.positionMs)}</TimeText>
        <SeekBar
          type="range"
          min={0}
          max={Math.max(0, state.durationMs)}
          step={100}
          value={state.positionMs}
          onChange={(e) => controller.seekTo(Number(e.target.value))}
          aria-label="Seek to position"
        />
        <TimeText>{formatElapsed(state.durationMs)}</TimeText>
      </SeekArea>

      <Section>
        {state.chapters.length > 0 && (
          <ChapterPicker
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) controller.seekToChapter(id);
            }}
            aria-label="Jump to chapter"
          >
            <option value="">Chapter…</option>
            {state.chapters
              .slice()
              .sort((a, b) => a.startMs - b.startMs)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({formatElapsed(c.startMs)})
                </option>
              ))}
          </ChapterPicker>
        )}
        <RatePicker
          value={String(state.rate)}
          onChange={(e) => controller.setRate(Number(e.target.value))}
          aria-label="Playback rate"
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="5">5×</option>
          <option value="10">10×</option>
          <option value="50">50×</option>
        </RatePicker>
        <ExitButton
          type="button"
          onClick={() => void controller.stop()}
          aria-label="Exit replay and return to live data"
        >
          Exit replay
        </ExitButton>
      </Section>
    </Bar>
  );
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const Bar = styled.div`
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--color-tag-purple-bg, var(--color-surface-raised));
  border-bottom: 2px solid var(--color-tag-purple-fg);
  color: var(--color-text-primary);
  font-size: 12px;
  letter-spacing: 0.04em;
`;

const Section = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const Title = styled.span`
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
`;

const Strong = styled.span`
  color: var(--color-tag-purple-fg);
  font-weight: 700;
  margin-left: 4px;
`;

const PlayButton = styled.button`
  background: var(--color-tag-purple-fg);
  border: none;
  color: var(--color-surface-app);
  cursor: pointer;
  font-size: 14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const SeekArea = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SeekBar = styled.input`
  flex: 1;
  min-width: 0;
  accent-color: var(--color-tag-purple-fg);
`;

const TimeText = styled.span`
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
`;

const RatePicker = styled.select`
  background: var(--color-surface-app);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 2px;
`;

const ChapterPicker = styled.select`
  background: var(--color-surface-app);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 2px;
  max-width: 180px;
`;

const ExitButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  &:hover { color: var(--color-tag-red-fg); border-color: var(--color-status-alert-muted); }
`;
