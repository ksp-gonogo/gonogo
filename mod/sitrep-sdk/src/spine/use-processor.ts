import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Reading } from "../reading";
import {
  activateProcessor,
  getProcessorValue,
  subscribeProcessor,
} from "./processorEvaluator";
import type { ProcessorHandle } from "./processors";

/** What a processor answers with: a datable reading, or the bare result. */
export type ProcessorResult<R, Carried extends boolean> = Carried extends true
  ? Reading<R>
  : R;

/**
 * Reactively read a Processor's current, frame-memoised value: the augment-side
 * consumption form, a hook wrapper around
 * the same evaluator a Contribution's compute() pulls from directly via a
 * ProcessorHandle dep (Task 3.5). Activates the processor for the life of the
 * calling component (ref-counted, so N widgets reading the same processor
 * share one evaluation) and deactivates on unmount.
 *
 * Degrades to undefined with no TelemetryProvider mounted, or before the first
 * frame lands, matching every other useStream-family hook's disconnected
 * contract.
 *
 * ## What comes back says how current it is, where the derivation can know
 *
 * A processor whose own deps include a reading answers a `Reading<R>`: its
 * inputs carried currency, so its answer is datable and says so. One depending
 * only on raw topic ids answers the bare `R` it always did, because there is
 * nothing to date it by.
 *
 * Which of the two is decided by the dep list and read off the handle, so a
 * processor that gains or loses a reading dep changes its consumers' TYPES
 * rather than changing what they receive behind their backs.
 */
export function useProcessor<R, Carried extends boolean>(
  handle: ProcessorHandle<R, string, Carried>,
): ProcessorResult<R, Carried> | undefined {
  useEffect(() => activateProcessor(handle.id), [handle.id]);

  const subscribe = useCallback(
    (onChange: () => void) => subscribeProcessor(handle.id, onChange),
    [handle.id],
  );
  const getSnapshot = useCallback(
    () => getProcessorValue<ProcessorResult<R, Carried>>(handle.id),
    [handle.id],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
