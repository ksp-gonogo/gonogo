import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useModeTimeline } from "./mode-view";
import { useTelemetrySourceFor } from "./telemetry-overlay";

/**
 * Something that happened at one moment, in a few plain words, such as a stage
 * firing. Returned by {@link useEvents}.
 *
 * @category Reading telemetry
 */
export interface StreamEvent {
  /** When it happened, in UT seconds. */
  ut: number;
  /** What happened, such as "Stage 1". */
  label: string;
}

const STRUCTURE = "vessel.structure";

/* A sample read straight off the store: a decoded field is a quantity, an undecoded one a bare number. */
function count(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  const m =
    v !== null && typeof v === "object"
      ? (v as { magnitude?: unknown }).magnitude
      : undefined;
  return typeof m === "number" ? m : undefined;
}

/**
 * The events between two moments, in time order: each stage the craft fired
 * in that stretch, and each moment the dashboard's mode marks on its timeline
 * there. `fromUt` and `toUt` are UT seconds and both ends count, as for the
 * history read of a Topic. Useful for a widget that draws the craft over a
 * stretch of time and wants to show where each event fell in it, such as a
 * tick across a path. A widget that does not call it is given nothing.
 *
 * It reads the same history the range read does, from the mode's values while
 * a mode answers for the craft and from the live game otherwise, so it can
 * answer only for the stretch the screen holds. A stage is taken from each
 * change of the stage the craft says it is on.
 *
 * @category Reading telemetry
 */
export function useEvents(
  fromUt: number,
  toUt: number,
): readonly StreamEvent[] {
  const { client, store } = useTelemetrySourceFor(STRUCTURE);
  // Held open for as long as the widget asks, since a store holds history only of what something is subscribed to.
  useEffect(() => client?.subscribe(STRUCTURE, () => {}), [client]);
  const marks = useModeTimeline()?.marks;
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribeFrame(cb) : () => {}),
    [store],
  );
  const held = useSyncExternalStore(subscribe, () =>
    store ? (store.sampleRange(STRUCTURE, -Infinity, toUt)?.length ?? 0) : 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `held` changes when the store holds another sample, which is when the range must be read again
  return useMemo(() => {
    const within = (ut: number) => ut >= fromUt && ut <= toUt;
    const events: StreamEvent[] = (marks ?? []).filter((mark) =>
      within(mark.ut),
    );
    // From the start of what is held, since a stage fired in the stretch is known by the stage the craft was on before it.
    const range =
      store?.sampleRange<{ currentStage?: unknown }>(
        STRUCTURE,
        -Infinity,
        toUt,
      ) ?? [];
    let last: number | undefined;
    for (const point of range) {
      const stage = count(point.payload?.currentStage);
      if (stage === undefined) continue;
      if (last !== undefined && stage !== last && within(point.validAt)) {
        events.push({ ut: point.validAt, label: `Stage ${stage}` });
      }
      last = stage;
    }
    return events.sort((a, b) => a.ut - b.ut);
  }, [store, marks, held, fromUt, toUt]);
}
