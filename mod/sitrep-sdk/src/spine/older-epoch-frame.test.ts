import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

describe("a frame from before a quickload", () => {
  it("never replaces the value that came after it, whatever order they arrive in", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("system.uplink.pending", () => undefined);

    const send = (payload: unknown, timelineEpoch: number, validAt: number) =>
      transport.emit("system.uplink.pending", payload, {
        timelineEpoch,
        validAt,
      });

    send({ at: "after" }, 2, 4010);
    // The host's replay sends the run's head first and its middle last, so older-epoch frames can follow the newest.
    send({ at: "before" }, 1, 9000);

    expect(client.getValue("system.uplink.pending")).toEqual({ at: "after" });
  });
});
