import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Reading } from "../reading";
import { useTelemetryStoreOptional } from "./context";
import { overlayCovers, useTelemetryOverlay } from "./overlay-context";
import {
  processorInputTopics,
  processorRuntimeFor,
} from "./processorEvaluator";
import { getProcessor, type ProcessorHandle } from "./processors";

/** What a processor answers with: a datable reading, or the bare result. */
export type ProcessorResult<
  Result,
  Carried extends boolean,
> = Carried extends true ? Reading<Result> : Result;

/**
 * The current value of a processor, the figure derived from telemetry that the
 * handle names, re-evaluated on every frame. Useful for showing the operator a
 * derived figure, such as where each body is, that the widget would otherwise
 * compute itself. Used by {@link useSystemInstant} to read the body positions.
 *
 * The processor is active for as long as the calling component is mounted, and
 * widgets reading the same processor share one evaluation. The value is there
 * from the mount. It is `undefined` when no `TelemetryProvider` is mounted.
 *
 * A processor whose dependencies include a reading answers a `Reading<Result>`,
 * which says how current the answer is. One depending only on raw topic ids
 * answers the bare `Result`. The handle's type decides which.
 */
export function useProcessor<Result, Carried extends boolean>(
  handle: ProcessorHandle<Result, string, Carried>,
): ProcessorResult<Result, Carried> | undefined {
  const live = useTelemetryStoreOptional();
  const overlay = useTelemetryOverlay();
  const store = overlayAnswers(overlay, handle.id) ? overlay?.store : live;
  const runtime = store ? processorRuntimeFor(store) : undefined;

  useEffect(() => runtime?.activate(handle.id), [runtime, handle.id]);

  const subscribe = useCallback(
    (onChange: () => void) =>
      runtime ? runtime.subscribe(handle.id, onChange) : () => {},
    [runtime, handle.id],
  );
  const getSnapshot = useCallback(
    () => runtime?.value<ProcessorResult<Result, Carried>>(handle.id),
    [runtime, handle.id],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}

/*
 * A processor runs on the overlay's store when the overlay answers any of the
 * Topics it reads, so a derived figure about a design is derived from the
 * design. One that reads only Topics the overlay does not answer (the bodies)
 * stays on the live store.
 */
function overlayAnswers(
  overlay: ReturnType<typeof useTelemetryOverlay>,
  id: string,
): boolean {
  if (!overlay) return false;
  const def = getProcessor(id);
  if (!def) return false;
  for (const topic of processorInputTopics(def)) {
    if (overlayCovers(overlay, topic)) return true;
  }
  return false;
}
