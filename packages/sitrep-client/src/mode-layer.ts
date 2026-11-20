import { enumerateTopicFields, type ModeSample } from "@ksp-gonogo/sitrep-sdk";
import {
  isDashboardTopic,
  type TelemetryOverlay,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { buildFullHistory } from "./full-history-replay";

/**
 * Everything a mode shows on one screen: the mode, whether its values are a
 * model's, and the frames its source supplied, as the mod's own `stream-data` frames with
 * the mode's id in `meta.mode`. The hosting screen makes one from its source's
 * output and sends the same value to every station.
 */
export interface ModeLayer {
  mode: string;
  /** `mode.state`'s `entry` when the frames were supplied, so a layer from an earlier time the mode was on is not shown. */
  entry: number;
  /** True when the values are worked out by a model, false when they were observed in a game at some time. */
  modelled: boolean;
  frames: readonly string[];
}

/**
 * The first field `topic`'s contract gives its payload that `payload` lacks,
 * or `undefined` when it has them all. A field that is present and null counts
 * as given: the contract says which fields may be null, and a null is an
 * answer.
 */
export function missingTopicField(
  topic: string,
  payload: unknown,
): string | undefined {
  if (payload === null || typeof payload !== "object") return "(the payload)";
  const has = payload as Record<string, unknown>;
  const fields = new Set(
    enumerateTopicFields(topic).map((field) => field.path.split(".")[0] ?? ""),
  );
  return [...fields].find((field) => has[field] === undefined);
}

/**
 * A source's samples as the frames a store is filled from, each carrying the
 * mode's id. Returns the reason instead when a sample is for one of the
 * dashboard's own Topics, or lacks a field its Topic's contract gives it.
 */
export function modeFrames(
  mode: string,
  samples: readonly ModeSample[],
): { frames: string[] } | { refused: string } {
  const frames: string[] = [];
  const ordered = [...samples].sort((a, b) => a.validAt - b.validAt);
  for (const [index, sample] of ordered.entries()) {
    if (isDashboardTopic(sample.topic)) {
      return {
        refused: `${sample.topic} is the dashboard's own, which no mode answers`,
      };
    }
    const missing = missingTopicField(sample.topic, sample.payload);
    if (missing !== undefined) {
      return {
        refused: `a ${sample.topic} sample has no ${missing}, which its contract gives it`,
      };
    }
    frames.push(
      JSON.stringify({
        type: "stream-data",
        topic: sample.topic,
        payload: sample.payload,
        meta: {
          source: "mode",
          validAt: sample.validAt,
          seq: index + 1,
          deliveredAt: sample.validAt,
          vantage: "meta",
          active: true,
          staleness: 0,
          timelineEpoch: 0,
          sampleId: index + 1,
          ...(sample.quality === undefined ? {} : { quality: sample.quality }),
          mode,
        },
      }),
    );
  }
  return { frames };
}

/* A frame is the text of one stream message, which is a JSON object. */
function frameOf<T extends object>(raw: string): T {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error(`a frame is not a JSON object: ${raw.slice(0, 64)}`);
  }
  return value as T;
}

/**
 * Frames recorded off the stream as a layer's frames: each stamped with the
 * mode's id, and the dashboard's own Topics left out, since a screen reads
 * those from the live game whatever the mode. Anything that is not a reading
 * or an event is left out too.
 */
export function recordedModeFrames(
  mode: string,
  frames: readonly string[],
): string[] {
  const kept: string[] = [];
  for (const raw of frames) {
    const message = frameOf<{
      type?: string;
      topic?: string;
      meta?: Record<string, unknown>;
    }>(raw);
    if (message.type !== "stream-data" && message.type !== "event") continue;
    if (!message.topic || isDashboardTopic(message.topic)) continue;
    kept.push(JSON.stringify({ ...message, meta: { ...message.meta, mode } }));
  }
  return kept;
}

/**
 * The live game's world as a mode's layer needs it: which Topics are world
 * Topics, and the newest frame the live stream holds of each Topic.
 */
export interface LiveWorld {
  /** Whether a Topic is about the world and not a craft, by what the running mod states. */
  isWorld: (topic: string) => boolean;
  /** The newest frame the live stream holds of each subscribed Topic. */
  held: readonly { topic: string; payload: unknown; meta: object }[];
}

interface LayerFrame {
  topic: string;
  meta?: { validAt?: number; timelineEpoch?: number };
}

/**
 * A layer as the second stream a screen reads the game from, or `undefined`
 * when the layer holds no sample at all. A mode answers for the whole craft
 * or for none of it: with any sample, every Topic about a craft is read from
 * the layer and one it has no sample for is not known; with none, the mode
 * has nothing to show and every tile stays on the live game.
 *
 * A Topic about the world is read from the live game, unless the layer holds
 * it. Given `world`, the layer's own store is also handed the live game's
 * newest value of each world Topic the layer lacks, in force from the layer's
 * first moment, so that what the store works out for itself, such as an orbit
 * carried forward about a body, has the bodies to work with. Those values are
 * as they stood when the layer was built.
 */
export function buildModeLayer(
  layer: ModeLayer,
  world?: LiveWorld,
): TelemetryOverlay | undefined {
  if (layer.frames.length === 0) return undefined;
  const parsed = layer.frames.map((frame) => frameOf<LayerFrame>(frame));
  const topics = [...new Set(parsed.map((frame) => frame.topic))];
  const borrowed = world
    ? borrowedWorld(layer.mode, parsed, topics, world)
    : [];
  const built = buildFullHistory(
    {
      subscribedTopics: [
        ...topics,
        ...borrowed.map((frame) => frameOf<LayerFrame>(frame).topic),
      ],
      frames: [...borrowed, ...layer.frames],
    },
    { id: layer.mode, modelled: layer.modelled },
  );
  return {
    mode: layer.mode as TelemetryOverlay["mode"],
    // Only what the mode itself supplied: a borrowed world Topic is still read from the live game, which keeps it current.
    topics,
    wholeCraft: true,
    ...(world ? { isWorld: world.isWorld } : {}),
    client: built.client,
    store: built.store,
  };
}

/** The live game's world Topics the layer lacks, as frames stamped with the layer's first moment and its timeline. */
function borrowedWorld(
  mode: string,
  parsed: readonly LayerFrame[],
  topics: readonly string[],
  world: LiveWorld,
): string[] {
  let first: LayerFrame | undefined;
  for (const frame of parsed) {
    const at = frame.meta?.validAt;
    if (typeof at !== "number") continue;
    if (first === undefined || at < (first.meta?.validAt ?? at)) first = frame;
  }
  const start = first?.meta?.validAt;
  if (start === undefined) return [];
  const has = new Set(topics);
  return world.held
    .filter(
      (frame) =>
        !has.has(frame.topic) &&
        !isDashboardTopic(frame.topic) &&
        world.isWorld(frame.topic),
    )
    .map((frame) =>
      JSON.stringify({
        type: "stream-data",
        topic: frame.topic,
        payload: frame.payload,
        meta: {
          ...frame.meta,
          validAt: start,
          deliveredAt: start,
          timelineEpoch: first?.meta?.timelineEpoch ?? 0,
          mode,
        },
      }),
    );
}

let current: ModeLayer | undefined;
const listeners = new Set<() => void>();

/** The layer this screen shows, or `undefined` in live mode or before the mode's source has supplied anything. */
export function getModeLayer(): ModeLayer | undefined {
  return current;
}

/** Sets the layer this screen shows. The hosting screen calls it with its source's output, a station with what the host sent. */
export function setModeLayer(layer: ModeLayer | undefined): void {
  if (current === layer) return;
  current = layer;
  for (const l of listeners) l();
}

export function onModeLayerChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
