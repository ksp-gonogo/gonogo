import type { PeerClient } from "../peer/PeerClientContext";
import type { CountdownEvent } from "./GoNoGoHostService";

/**
 * The countdown events of the main screen's poll as a station hears them: a
 * start with the time left, a cancel as an abort, and the reset the main screen
 * sends at T-0 as a go. A station that joins mid-countdown hears a start with the
 * time still left, so its length is that.
 */
export function stationCountdownEvents(
  client: PeerClient,
  listener: (event: CountdownEvent) => void,
): () => void {
  const unsubs = [
    client.onGonogoCountdownStart((t0Ms) =>
      listener({ type: "start", lengthMs: Math.max(0, t0Ms - Date.now()) }),
    ),
    client.onGonogoCountdownCancel(() =>
      listener({ type: "end", how: "aborted" }),
    ),
    client.onGonogoReset(() => listener({ type: "end", how: "go" })),
    client.onHostRestart(() => listener({ type: "end", how: "aborted" })),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
