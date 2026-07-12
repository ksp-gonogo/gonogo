import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { StubTransport } from "./stub-transport";

describe("StubTransport", () => {
  it("emits stream-data only for subscribed topics", () => {
    const t = new StubTransport();
    const seen: ServerMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.emit("vessel.altitude", 100); // not subscribed yet -> ignored
    t.send({ type: "subscribe", topic: "vessel.altitude" });
    t.emit("vessel.altitude", 200); // subscribed -> delivered
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: "stream-data",
      topic: "vessel.altitude",
      payload: 200,
    });
  });
  it("answers a command-request with a command-response from the handler, on a later microtask", async () => {
    const t = new StubTransport();
    t.setCommandHandler((command, args) => ({ echoed: command, args }));
    const seen: ServerMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.send({
      type: "command-request",
      requestId: "r1",
      command: "deploy",
      args: 42,
      sentAt: 0,
    });
    // The response must not be visible synchronously — it settles on a
    // later microtask, modeling a real transport's round trip.
    expect(seen).toHaveLength(0);
    await Promise.resolve();
    expect(seen[0]).toMatchObject({
      type: "command-response",
      requestId: "r1",
      result: { echoed: "deploy", args: 42 },
    });
  });
});
