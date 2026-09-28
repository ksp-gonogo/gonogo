import { value } from "@ksp-gonogo/sitrep-sdk";
import { useTransmissions } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function setup() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);

  function Downlink() {
    const transmissions = useTransmissions();
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            transmissions.expect({
              label: "Crew Report",
              subject: "crewReport@KerbinSrfLandedShores",
              sentAt: value("ut", 100),
            })
          }
        >
          sent
        </button>
        <span>tags:{Object.values(transmissions.tags).join("/")}</span>
        <ul>
          {transmissions.inFlight.map((row) => (
            <li key={row.id}>
              {row.label} {row.direction} {row.predictedPhase} reach:
              {row.reachEtaSeconds} reply:{String(row.replyEtaSeconds)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  render(
    <TelemetryProvider client={client} store={store}>
      <Downlink />
    </TelemetryProvider>,
  );

  const oneWay = (seconds: number | null) =>
    act(() => {
      transport.emit(
        "comms.delay",
        { source: 1, oneWaySeconds: seconds },
        { validAt: 100, deliveredAt: 100 },
      );
    });
  const elapse = (seconds: number) =>
    act(() => {
      wall.advanceBy(seconds);
      vi.advanceTimersByTime(seconds * 1000);
    });
  return { oneWay, elapse };
}

describe("useTransmissions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts a transmission on the rail as a fire-and-forget crossing home", () => {
    const { oneWay } = setup();
    oneWay(4);
    act(() => screen.getByText("sent").click());

    expect(
      screen.getByText("tags:telemetry/discrete/fire-and-forget"),
    ).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe(
      "Crew Report telemetry in-transit reach:4 reply:null",
    );
  });

  it("takes the row off the rail when the transmission arrives", () => {
    const { oneWay, elapse } = setup();
    oneWay(4);
    act(() => screen.getByText("sent").click());
    elapse(3);
    expect(screen.getByRole("listitem").textContent).toContain("reach:1");

    elapse(2);
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("draws nothing with no live delay to place the transmission on", () => {
    const { oneWay } = setup();
    oneWay(null);
    act(() => screen.getByText("sent").click());
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
