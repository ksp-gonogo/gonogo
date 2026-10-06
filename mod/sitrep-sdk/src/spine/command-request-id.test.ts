import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";

const FROZEN_CLOCK: Clock = {
  now: () => 0,
  schedule: () => () => {},
};

function newClient(options?: { idPrefix?: string }) {
  const client = new TelemetryClient(
    new StubTransport(),
    FROZEN_CLOCK,
    options,
  );
  client.setDelaySource(() => 0);
  return client;
}

describe("command request ids", () => {
  it("never repeat across two clients, which is what two page loads are", () => {
    const first = newClient();
    const second = newClient();
    const firstIds = [1, 2, 3].map(
      (n) => first.dispatch("x.y", { n }).requestId,
    );
    const secondIds = [1, 2, 3].map(
      (n) => second.dispatch("x.y", { n }).requestId,
    );
    for (const id of secondIds) expect(firstIds).not.toContain(id);
  });

  it("are deterministic within a client and take a fixed prefix", () => {
    const client = newClient({ idPrefix: "t" });
    expect(client.dispatch("x.y").requestId).toBe("t-0");
    expect(client.dispatch("x.y").requestId).toBe("t-1");
  });

  it("can be chosen by the caller, and a second use of one is refused", () => {
    const client = newClient({ idPrefix: "t" });
    const { requestId } = client.dispatch(
      "x.y",
      undefined,
      "",
      "",
      "",
      "station-1",
    );
    expect(requestId).toBe("station-1");
    expect(() =>
      client.dispatch("x.y", undefined, "", "", "", "station-1"),
    ).toThrow(/already in use/);
  });
});
