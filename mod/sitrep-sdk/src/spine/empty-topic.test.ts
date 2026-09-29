import { afterEach, describe, expect, it, vi } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TelemetryClient.subscribe with an empty topic", () => {
  it("sends neither a subscribe nor an unsubscribe for it, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new StubTransport();
    const send = vi.spyOn(transport, "send");
    const client = new TelemetryClient(transport);

    const first = client.subscribe("", () => {});
    const second = client.subscribe("", () => {});
    first();
    second();

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still subscribes a named topic", () => {
    const transport = new StubTransport();
    const send = vi.spyOn(transport, "send");
    const client = new TelemetryClient(transport);

    client.subscribe("vessel.flight", () => {})();

    expect(send.mock.calls.map(([message]) => message.type)).toEqual([
      "subscribe",
      "unsubscribe",
    ]);
  });
});
