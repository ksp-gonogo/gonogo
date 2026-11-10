import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_PUBLISHED_PROCESSORS,
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { parseServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { createFakeWallClock } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";

const LINK_RETURNS_AT = 52003.02;

const RECORDING = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/wire/link-returns-after-time-jump.jsonl",
);

/** Each frame of the recording as it arrived: its wall time in ms and its raw text. */
function recordedFrames(): { at: number; raw: string }[] {
  return readFileSync(RECORDING, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const row: { t: number; f: unknown } = JSON.parse(line);
      return { at: row.t, raw: JSON.stringify(row.f) };
    });
}

interface Frame {
  type?: string;
  topic?: string;
  payload?: { connected?: boolean | null };
  meta?: {
    validAt: number;
    deliveredAt: number;
    seq: number;
    staleness: number;
  };
}

/**
 * Replays the capture in the order and at the pace it arrived, and reports each
 * topic's status after the frame that carries `comms.link` back to connected.
 * With `keyframes`, the mod's one Fresh keyframe per recorded topic is added
 * beside that frame, carrying the topic's last recorded payload.
 */
function statusesAfterTheLinkFrame(keyframes: boolean): Map<string, string> {
  const recording = recordedFrames();
  const raw = recording.map((row) => row.raw);
  const parsed: Frame[] = raw.map((r) => JSON.parse(r));

  let listener: ((message: unknown) => void) | undefined;
  const transport = {
    status: "connected" as const,
    send() {},
    onMessage(l: (message: unknown) => void) {
      listener = l;
      return () => {};
    },
    onStatusChange: () => () => {},
  };
  const wall = createFakeWallClock(0);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES,
  });
  for (const processor of CORE_PUBLISHED_PROCESSORS) {
    store.publishProcessor(processor);
  }
  clock.suspendFrames();
  // biome-ignore lint/suspicious/noExplicitAny: the replay feeds the transport the way a socket does
  const client = new TelemetryClient(transport as any);
  client.attachStore(store);

  const lastFrame = new Map<string, Frame>();
  const start = recording[0].at;
  let at = 0;
  const topics = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const frame = parsed[i];
    const seconds = (recording[i].at - start) / 1000;
    wall.advanceBy(seconds - at);
    at = seconds;
    if (frame.topic) topics.add(frame.topic);
    if (frame.type === "stream-data" && frame.topic) {
      lastFrame.set(frame.topic, frame);
    }
    listener?.(parseServerMessage(raw[i]));

    const isLinkFrame =
      frame.topic === "comms.link" &&
      frame.payload?.connected === true &&
      frame.meta?.validAt !== undefined &&
      Math.abs(frame.meta.validAt - LINK_RETURNS_AT) < 0.01;
    if (!isLinkFrame) continue;

    if (keyframes) {
      for (const recorded of lastFrame.values()) {
        if (recorded.meta?.staleness !== 3) continue;
        const keyframe = {
          ...recorded,
          meta: {
            ...recorded.meta,
            staleness: 0,
            validAt: LINK_RETURNS_AT,
            deliveredAt: LINK_RETURNS_AT + 0.0004,
            seq: (recorded.meta?.seq ?? 0) + 100000,
          },
        };
        listener?.(parseServerMessage(JSON.stringify(keyframe)));
      }
    }
    clock.emitFrame();
    const token = store.beginFrame();
    const statuses = new Map<string, string>();
    for (const topic of topics) {
      if (topic.startsWith("vessel.") || topic.startsWith("comms.")) {
        statuses.set(topic, store.sampleStatus(topic, token));
      }
    }
    return statuses;
  }
  throw new Error("the frame that returns the link was not in the recording");
}

describe("the link returning after a time jump", () => {
  it("reads every vessel topic as live within the frame that returns the link, once the mod keyframes the quiet ones", () => {
    const statuses = statusesAfterTheLinkFrame(true);
    // An absent topic is a confirmed absence, which no keyframe changes.
    const vessel = [...statuses].filter(
      ([t, status]) => t.startsWith("vessel.") && status !== "absent",
    );
    expect(vessel.length).toBeGreaterThan(0);
    expect(vessel.filter(([, status]) => status !== "live")).toEqual([]);
  });

  it("keeps a topic on its Recorded point when no keyframe follows, since the stamp the mod sent wins", () => {
    const statuses = statusesAfterTheLinkFrame(false);
    expect(statuses.get("vessel.structure")).toBe("recorded");
    expect(statuses.get("vessel.identity")).toBe("recorded");
  });
});
