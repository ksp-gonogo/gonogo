import type { ReactNode } from "react";
import type { TelemetryClient } from "./client";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import {
  isDashboardTopic,
  overlayCovers,
  type TelemetryOverlay,
  TelemetryOverlayContext,
  useTelemetryOverlay,
} from "./overlay-context";
import type { TimelineStore } from "./timeline-store";

export function TelemetryOverlayProvider({
  overlay,
  children,
}: {
  overlay: TelemetryOverlay | undefined;
  children: ReactNode;
}) {
  return (
    <TelemetryOverlayContext.Provider value={overlay}>
      {children}
    </TelemetryOverlayContext.Provider>
  );
}

/** The client and store a read of `topic` goes to: the overlay's when it covers the Topic, else the live stream's. */
export function useTelemetrySourceFor(topic: string): {
  client: TelemetryClient | undefined;
  store: TimelineStore | undefined;
} {
  const overlay = useTelemetryOverlay();
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  // gonogo:reads none
  const store = useTelemetryStoreOptional();
  if (overlay && overlayCovers(overlay, topic)) {
    return { client: overlay.client, store: overlay.store };
  }
  return { client, store };
}

export {
  isDashboardTopic,
  overlayCovers,
  type TelemetryOverlay,
  useTelemetryOverlay,
};
