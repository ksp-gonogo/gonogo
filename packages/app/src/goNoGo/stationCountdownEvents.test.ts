import { describe, expect, it, vi } from "vitest";
import type { PeerClient } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import type { CountdownEvent } from "./GoNoGoHostService";
import { stationCountdownEvents } from "./stationCountdownEvents";

function station() {
  const handlers: Record<string, (...args: never[]) => void> = {};
  const client: PeerClient = {
    ...idlePeerClient(),
    onGonogoCountdownStart: (cb) => {
      handlers.start = cb;
      return () => {};
    },
    onGonogoCountdownCancel: (cb) => {
      handlers.cancel = cb;
      return () => {};
    },
    onGonogoReset: (cb) => {
      handlers.reset = cb;
      return () => {};
    },
    onHostRestart: (cb) => {
      handlers.restart = cb;
      return () => {};
    },
  };
  const events: CountdownEvent[] = [];
  stationCountdownEvents(client, (event) => events.push(event));
  return { handlers, events };
}

describe("the countdown as a station hears it", () => {
  it("is a start with the time left, then GO at the reset the main screen sends at T-0", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { handlers, events } = station();
    (handlers.start as (t0Ms: number) => void)(11_000);
    (handlers.reset as () => void)();
    expect(events).toEqual([
      { type: "start", lengthMs: 10_000 },
      { type: "end", how: "go" },
    ]);
    vi.restoreAllMocks();
  });

  it("ends as aborted on a cancel and on a main screen that restarted", () => {
    const { handlers, events } = station();
    (handlers.cancel as () => void)();
    (handlers.restart as () => void)();
    expect(events).toEqual([
      { type: "end", how: "aborted" },
      { type: "end", how: "aborted" },
    ]);
  });
});
