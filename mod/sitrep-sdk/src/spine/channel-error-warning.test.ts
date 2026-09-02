import { afterEach, describe, expect, it } from "vitest";
import { installTestHost, resetTestHost } from "../testing/install-test-host";
import { StubTransport } from "../testing/stub-transport";
import { channelErrorMessage } from "./channel-error-warning";
import { TelemetryClient } from "./client";

describe("the channel-error warning", () => {
  afterEach(() => {
    resetTestHost();
  });

  it("names the topic, the code and what the author has to change", () => {
    const message = channelErrorMessage(
      "burn.plan",
      "payload-serialization-error",
      'channel "burn.plan" payload of type Acme.BurnPlan could not be serialized: unsupported CLR value type Acme.BurnPlan',
    );
    expect(message).toContain('"burn.plan"');
    expect(message).toContain("payload-serialization-error");
    expect(message).toContain("Acme.BurnPlan");
    expect(message).toContain("Dictionary<string, object?>");
  });

  /**
   * The regression this exists for. An `error` frame carries a topic and NO
   * requestId when a channel dies at the wire boundary, and the command
   * correlator returns immediately on a missing requestId: the frame used to
   * be discarded there, leaving the author with exactly the silence the mod
   * had just gone to the trouble of explaining.
   */
  it("reports a topic-bearing error frame instead of discarding it", () => {
    const logged: string[] = [];
    installTestHost({
      logger: {
        warn: (message: string) => logged.push(message),
      },
    } as never);

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("burn.plan", () => {});

    transport.emitRaw({
      type: "error",
      topic: "burn.plan",
      code: "payload-serialization-error",
      message:
        "could not be serialized: unsupported CLR value type Acme.BurnPlan",
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"burn.plan"');
    expect(logged[0]).toContain("Acme.BurnPlan");
  });

  it("reports once per topic and code, not once per frame", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("burn.plan", () => {});

    for (let i = 0; i < 5; i++) {
      transport.emitRaw({
        type: "error",
        topic: "burn.plan",
        code: "payload-serialization-error",
        message: "could not be serialized",
      });
    }

    expect(logged).toHaveLength(1);
  });

  /**
   * A command's own error reply still correlates by requestId. The two shapes
   * share one frame type, so routing on "has a topic" alone would swallow a
   * command failure into a log line and leave its promise hanging forever.
   */
  it("leaves a command's error reply to the command correlator", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    transport.emitRaw({
      type: "error",
      requestId: "req-1",
      topic: "burn.execute",
      code: "E_UNAVAILABLE",
      message: "uplink is unavailable",
    });

    // Not logged as a channel fault, and it did reach the command correlator:
    // `idle` is what that correlator answers for a requestId it has no pending
    // entry for, which is the honest outcome for a reply to a command this
    // client never dispatched. Routing on "has a topic" alone would have
    // swallowed it into a log line instead.
    expect(logged).toEqual([]);
    expect(client.getCommand("req-1")).toEqual({ phase: "idle" });
  });
});
