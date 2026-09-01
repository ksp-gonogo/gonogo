import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  activateProcessor,
  getProcessorValue,
  subscribeProcessor,
} from "./processorEvaluator";
import type { ProcessorHandle } from "./processors";

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
 */
export function useProcessor<R>(handle: ProcessorHandle<R>): R | undefined {
  useEffect(() => activateProcessor(handle.id), [handle.id]);

  const subscribe = useCallback(
    (onChange: () => void) => subscribeProcessor(handle.id, onChange),
    [handle.id],
  );
  const getSnapshot = useCallback(
    () => getProcessorValue<R>(handle.id),
    [handle.id],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
