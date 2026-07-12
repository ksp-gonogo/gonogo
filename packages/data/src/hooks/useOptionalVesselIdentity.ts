import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import type { VesselIdentity } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useSyncExternalStore } from "react";

/**
 * `useStream("vessel.identity")`'s own read/subscribe logic (`use-stream.ts`),
 * rebuilt on the OPTIONAL client/store accessors instead of the throwing
 * `useTelemetryClient`/`useTelemetryStore`. Extracted out of
 * `AutoRecordController` (its original, still-primary consumer — see that
 * component's own doc comment for the full "why optional" rationale) so
 * `useFlight` can share the exact same read without either package importing
 * the other's feature module. Degrades to `undefined` — never throws — when
 * no `TelemetryProvider` is mounted (every station screen today, and the
 * brief window on the main screen before its stream connects).
 */
export function useOptionalVesselIdentity(): VesselIdentity | undefined {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const inputTopics = store.resolveSubscriptionTopics("vessel.identity");
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
      };
    },
    [client, store],
  );

  const getSnapshot = useCallback((): VesselIdentity | undefined => {
    if (!store) return undefined;
    const point = store.sample<VesselIdentity>(
      "vessel.identity",
      store.currentFrame(),
    );
    // `payload` can be `null` (a confirmed tombstone — vessel confirmed
    // absent); either that or "no point at all" collapses to `undefined`
    // here, since callers have nothing useful to do with either.
    return point?.payload ?? undefined;
  }, [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
