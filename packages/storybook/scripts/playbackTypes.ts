export interface PlaybackEmit {
  channel: string;
  value: unknown;
  meta?: Record<string, unknown>;
}

export interface PlaybackFrame {
  /** Only the channels that changed on this frame. */
  emits: PlaybackEmit[];
  caption: string;
}

/** A widget and the small deterministic model that drives it, frame by frame. */
export interface PlaybackScenario {
  widgetId: string;
  scenario: string;
  notes: string;
  /** Channels sent once, with the first frame, that the rest of the playback leaves alone. */
  staticEmits: PlaybackEmit[];
  frames: PlaybackFrame[];
  /** Real milliseconds each frame is shown for. */
  stepMs: number;
  defaultSize: { w: number; h: number };
}
