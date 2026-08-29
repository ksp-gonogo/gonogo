import type { Screen } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import { useKerbcastMainConnect } from "./hooks/useKerbcastMainConnect";
import { kerbcastSource } from "./KerbcastDataSource";
import { KERBCAST_EVENTS_TOPIC } from "./KerbcastEventProducer";
import { KERBCAST } from "./uplink";

/**
 * kerbcast connecting itself, and feeding its own occurrences to the alarm host.
 *
 * <p>Both used to be the app's job: `MainScreen` called this Uplink's connect
 * hook by name and built the alarm host's revealed-events reader out of this
 * Uplink's producer. That put this package in the app's import graph, which no
 * third-party Uplink could ever be, and left the `event` trigger with room for
 * exactly one producer: this one.</p>
 */
function KerbcastMainConnect({ children }: { children: ReactNode }) {
  useKerbcastMainConnect();
  return <>{children}</>;
}

/**
 * <p>The connect is MAIN-ONLY: a station receives camera media re-streamed
 * through the host's peer connection and must not open its own. `screen` never
 * changes for a mounted tree, so branching on it here is a stable choice of
 * component rather than a conditional hook.</p>
 */
function KerbcastRootProvider({
  screen,
  children,
}: {
  screen: Screen;
  children: ReactNode;
}) {
  if (screen !== "main") return <>{children}</>;
  return <KerbcastMainConnect>{children}</KerbcastMainConnect>;
}

KERBCAST.registerRootProvider({
  id: "main-connect",
  Provider: KerbcastRootProvider,
});

KERBCAST.registerRevealedEventSource({
  id: "events",
  topic: KERBCAST_EVENTS_TOPIC,
  revealedEvents: (viewUt) => kerbcastSource.revealedEvents(viewUt),
});
