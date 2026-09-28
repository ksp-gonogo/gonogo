import {
  resolveValueTopic,
  subscribeTopicRead,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useEffect, useState } from "react";

/**
 * Reads the latest value of every tag, one Topic per note-body placeholder
 * (`{{v.altitude}}`-style), and re-renders whenever any of them change.
 *
 * Resolved imperatively for a DYNAMIC tag list rather than as one fixed hook
 * call, since a `useTelemetry` loop would change hook count as the tag list
 * grows and shrinks mid-edit. A tag naming no topic never resolves and stays
 * `undefined`, like any other never-arrived value.
 */
export function useTagValues(tags: readonly string[]): Map<string, unknown> {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const [snapshot, setSnapshot] = useState<Map<string, unknown>>(
    () => new Map(),
  );

  useEffect(() => {
    const next = new Map<string, unknown>();
    const unsubs: Array<() => void> = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      setSnapshot(new Map(next));
    };
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      // Microtask coalesce: many tags can update in the same tick; one re-render per flush is enough.
      queueMicrotask(flush);
    };

    for (const tag of tags) {
      const topic = resolveValueTopic(tag);
      if (!client || !store || topic === undefined) continue;
      const releaseInputs = subscribeTopicRead(client, store, topic);
      const unsubscribeFrame = store.subscribeFrame(() => {
        const point = store.sample(topic, store.currentFrame());
        const value = point ? point.payload : undefined;
        if (Object.is(next.get(tag), value)) return;
        next.set(tag, value);
        scheduleFlush();
      });
      unsubs.push(() => {
        unsubscribeFrame();
        releaseInputs();
      });
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [tags, client, store]);
  return snapshot;
}
