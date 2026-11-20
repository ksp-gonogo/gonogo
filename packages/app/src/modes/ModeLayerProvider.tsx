import {
  buildModeLayer,
  getModeLayer,
  onModeLayerChange,
} from "@ksp-gonogo/sitrep-client";
import {
  heldFrames,
  isWorldTopicFor,
  type TelemetryOverlay,
  TelemetryOverlayProvider,
  useModeState,
  useModeTimeline,
  useSeat,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

/*
 * A mode's store has no stream driving it, so nothing starts its frames: each
 * move of this screen's place on the timeline moves the store's clock there
 * and starts the one frame that shows it. The timeline hook re-renders every
 * animation frame while playing, so a playing timeline moves the store too.
 */
function ModeCursor({ overlay }: { overlay: TelemetryOverlay }) {
  const at = useModeTimeline()?.at;
  useEffect(() => {
    if (at === undefined) return;
    overlay.store.clock.scrubTo(at);
    overlay.store.beginFrame();
  }, [overlay, at]);
  return null;
}

/**
 * Lays the dashboard's mode over the live stream for everything below it: a
 * Topic the mode answers is read from the mode's own store, at this screen's
 * place on the mode's timeline, and every other Topic from the live game.
 * Mount it once per screen, inside the telemetry provider and around the
 * tiles. In live mode, and at the pilot seat, it changes nothing.
 */
export function ModeLayerProvider({ children }: { children: ReactNode }) {
  const layer = useSyncExternalStore(onModeLayerChange, getModeLayer);
  const state = useModeState();
  const seat = useSeat();
  const mode = state?.mode;
  const entry = state ? Number(state.entry) : undefined;
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  // gonogo:reads none
  const store = useTelemetryStoreOptional();
  const overlay = useMemo(
    () =>
      layer &&
      seat === "mission-control" &&
      layer.mode === mode &&
      layer.entry === entry
        ? buildModeLayer(
            layer,
            client && store
              ? {
                  isWorld: (topic: string) => isWorldTopicFor(store, topic),
                  held: heldFrames(client),
                }
              : undefined,
          )
        : undefined,
    [layer, seat, mode, entry, client, store],
  );
  return (
    <TelemetryOverlayProvider overlay={overlay}>
      {overlay ? <ModeCursor overlay={overlay} /> : null}
      {children}
    </TelemetryOverlayProvider>
  );
}
