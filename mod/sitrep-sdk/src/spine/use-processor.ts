import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Reading } from "../reading";
import { useTelemetryStoreOptional } from "./context";
import { processorRuntimeFor } from "./processorEvaluator";
import type { ProcessorHandle } from "./processors";

/** What a processor answers with: a datable reading, or the bare result. */
export type ProcessorResult<
  Result,
  Carried extends boolean,
> = Carried extends true ? Reading<Result> : Result;

/**
 * Reactively read a Processor's current, frame-memoised value: the augment-side
 * consumption form, a hook wrapper around
 * the same evaluator a Contribution's compute() pulls from directly via a
 * ProcessorHandle dep (Task 3.5). Activates the processor for the life of the
 * calling component (ref-counted, so N widgets reading the same processor
 * share one evaluation) and deactivates on unmount.
 *
 * The value is there from the mount: the processor is evaluated against the
 * nearest provider's store, at its current frame as it activates, then again
 * on every frame boundary. Degrades to undefined with no TelemetryProvider
 * mounted, matching every other useStream-family hook's disconnected contract.
 *
 * ## What comes back says how current it is, where the derivation can know
 *
 * A processor whose own deps include a reading answers a `Reading<Result>`: its
 * inputs carried currency, so its answer is datable and says so. One depending
 * only on raw topic ids answers the bare `Result` it always did, because there is
 * nothing to date it by.
 *
 * Which of the two is decided by the dep list and read off the handle, so a
 * processor that gains or loses a reading dep changes its consumers' TYPES
 * rather than changing what they receive behind their backs.
 */
export function useProcessor<Result, Carried extends boolean>(
  handle: ProcessorHandle<Result, string, Carried>,
): ProcessorResult<Result, Carried> | undefined {
  const store = useTelemetryStoreOptional();
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
