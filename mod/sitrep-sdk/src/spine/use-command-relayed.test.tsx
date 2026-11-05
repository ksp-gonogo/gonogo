// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act, render, screen } from "../testing";
import { StubTransport } from "../testing/stub-transport";
import { value } from "../unit-system/value";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { useCommand } from "./use-command";

const COMMAND = "vessel.control.setRcs";
const STATION_ID = "station-ab12:c1";

function Rows() {
  const command = useCommand(COMMAND, { rail: false });
  return (
    <ul>
      {command.inFlight.map((row) => (
        <li key={row.id}>{`${row.id}:${row.predictedPhase}`}</li>
      ))}
    </ul>
  );
}

function setUp() {
  const displayTransport = new StubTransport();
  const display = new TelemetryClient(displayTransport);
  const jobsTransport = new StubTransport();
  const jobs = new TelemetryClient(jobsTransport);
  jobs
    .dispatch(COMMAND, {}, "Toggle RCS", "", "", STATION_ID)
    .result.catch(() => undefined);
  display.carryCommandsFrom(jobs);
  render(
    <TelemetryProvider client={display}>
      <Rows />
    </TelemetryProvider>,
  );
  act(() => {
    displayTransport.emitRaw({
      type: "stream-data",
      topic: "system.uplink.pending",
      payload: {
        pending: [
          {
            id: "engine-1",
            clientRequestId: STATION_ID,
            command: COMMAND,
            label: "Toggle RCS",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: value("ut", 0),
            oneWaySeconds: value("s", 20),
          },
        ],
        settled: [],
      },
      meta: {
        source: "test",
        validAt: 0,
        seq: 0,
        deliveredAt: 0,
        vantage: "ground:Kerbin: KSC",
        quality: 0,
        active: false,
        staleness: 0,
        timelineEpoch: 0,
      },
    } as never);
  });
  return { jobsTransport };
}

describe("a main screen's row for a station's command", () => {
  it("follows the client that carries the command", () => {
    const { jobsTransport } = setUp();
    expect(screen.getByRole("listitem").textContent).toContain(STATION_ID);

    act(() => {
      jobsTransport.emitRaw({
        type: "command-response",
        requestId: STATION_ID,
        result: { success: true },
        meta: {},
      } as never);
    });

    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
