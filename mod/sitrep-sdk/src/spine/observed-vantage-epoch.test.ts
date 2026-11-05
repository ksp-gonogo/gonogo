import { describe, expect, it } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

/**
 * A station that joins after a quickload is handed frames from before it. Those
 * carry the earlier timeline epoch and the centre the session has since left,
 * and must not move the centre the station observes.
 */
describe("TelemetryClient's observed vantage across timeline epochs", () => {
  function harness() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    client.subscribe("comms.delay", () => {});
    return { transport, client };
  }

  it("ignores a replayed frame from an earlier epoch", () => {
    const { transport, client } = harness();
    transport.emit(
      "comms.delay",
      {},
      { deliveredAt: 10, timelineEpoch: 2, vantage: "ground:ksc" },
    );
    transport.emit(
      "comms.delay",
      {},
      { deliveredAt: 500, timelineEpoch: 1, vantage: "vessel:old" },
    );

    expect(client.observedVantage).toBe("ground:ksc");
  });

  it("takes a frame from a later epoch whatever its delivery time", () => {
    const { transport, client } = harness();
    transport.emit(
      "comms.delay",
      {},
      { deliveredAt: 500, timelineEpoch: 1, vantage: "vessel:old" },
    );
    transport.emit(
      "comms.delay",
      {},
      { deliveredAt: 10, timelineEpoch: 2, vantage: "ground:ksc" },
    );

    expect(client.observedVantage).toBe("ground:ksc");
  });
});
