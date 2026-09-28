import {
  subscribeTopicRead,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useCallback, useSyncExternalStore } from "react";

/** `useStream` that returns `undefined` when no `TelemetryProvider` is mounted, so a provider-less render degrades to the empty state. */
export function useStreamOptional<Payload>(topic: string): Payload | undefined {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const releaseInputs = subscribeTopicRead(client, store, topic);
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        releaseInputs();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback((): Payload | undefined => {
    if (!store) return undefined;
    const point = store.sample<Payload>(topic, store.currentFrame());
    return point ? (point.payload as Payload | undefined) : undefined;
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
