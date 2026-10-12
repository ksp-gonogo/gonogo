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
