import { afterEach, describe, expect, it } from "vitest";
import { installTestHost, resetTestHost } from "../testing/install-test-host";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { connectionErrorMessage } from "./connection-error-warning";

describe("the connection-error warning", () => {
  afterEach(() => {
    resetTestHost();
  });

  it("names the code and keeps the mod's own sentence", () => {
    const message = connectionErrorMessage(
      "binary-frame-not-accepted",
      "the stream-binary lane is server-to-client only; send bytes as a command's arguments instead",
    );
    expect(message).toContain("binary-frame-not-accepted");
    expect(message).toContain("server-to-client only");
  });

  /**
   * The regression this exists for. `Sitrep.Host`'s `RefuseInboundBinaryFrame`
   * mints an `ErrorMsg` with neither a requestId nor a topic, because the fault
   * is about the connection and not about any one command or channel. Both
   * branches above the command correlator need one of those two fields, and the
   * correlator itself returned immediately on a missing requestId, so the mod's
   * answer reached the wire and went no further.
   */
  it("reports an uncorrelated error frame instead of discarding it", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    new TelemetryClient(transport);

    transport.emitRaw({
      type: "error",
      code: "binary-frame-not-accepted",
      message:
        "the stream-binary lane is server-to-client only; send bytes as a command's arguments instead",
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("binary-frame-not-accepted");
    expect(logged[0]).toContain("server-to-client only");
  });

  /**
   * The other live producer: `set-vantage` carries no requestId in the
   * envelope, so its refusal cannot be correlated even in principle.
   */
  it("reports the unknown-vantage refusal of a set-vantage", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    new TelemetryClient(transport);

    transport.emitRaw({
      type: "error",
      code: "unknown-vantage",
      message: "'ksc-2' is not an active command centre",
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("unknown-vantage");
    expect(logged[0]).toContain("ksc-2");
  });

  it("reports once per code, not once per frame", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    new TelemetryClient(transport);

    for (let i = 0; i < 5; i++) {
      transport.emitRaw({
        type: "error",
        code: "binary-frame-not-accepted",
        message: "unknown binary lane 0x07",
      });
    }

    expect(logged).toHaveLength(1);
  });

  /**
   * The two correlated shapes still route where they did. Three branches share
   * one frame type, and sending a command's reply here would swallow it into a
   * log line and leave its promise hanging for ever.
   */
  it("leaves a correlated error to the command correlator", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    transport.emitRaw({
      type: "error",
      requestId: "req-1",
      code: "E_UNAVAILABLE",
      message: "uplink is unavailable",
    });

    expect(logged).toEqual([]);
    expect(client.getCommand("req-1")).toEqual({ phase: "idle" });
  });

  it("leaves a topic-bearing error to the channel warning", () => {
    const logged: string[] = [];
    installTestHost({
      logger: { warn: (message: string) => logged.push(message) },
    } as never);

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("burn.plan", () => {});

    transport.emitRaw({
      type: "error",
      topic: "burn.plan",
      code: "payload-serialization-error",
      message: "could not be serialized",
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("[channel error]");
  });
});
