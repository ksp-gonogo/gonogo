import { useTelemetry } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { clearReckoners, registerReckoner } from "./reckoners";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useStream } from "./use-stream";
import { ViewClock } from "./view-clock";

/**
 * What a POINT read holds up, as against what it reads.
 *
 * The series half of this was fixed first (`useDataSeries`, and the store's
 * `reckonerDepTopics` under it). Every point read had the same hole and for the
 * same reason: a read subscribed the topic it was reading and a derived
 * channel's declared `inputs`, and a raw topic's reckoner deps are neither, so
 * a model whose declared inputs nobody else on the screen happened to be
 * holding up declined `input-absent` for ever. `vessel.flight`'s reckoner
 * declares `vessel.orbit` and `system.bodies`, and a widget reading an altitude
 * has no reason to know that.
 *
 * The assertions are on the TRANSPORT rather than on a rendered value: a
 * subscription is the thing that was missing, `StubTransport.emit` is
 * subscription-gated, and asking the transport says "this read reaches the
 * channel" rather than "this read happened to render something this frame".
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "test.contact",
  "test.temperature",
];

function buildFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(600);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={CARRIED}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, Provider };
}

function StreamProbe({ topic }: { topic: string }) {
  const value = useStream<unknown>(topic);
  return <div data-testid="probe">{value === undefined ? "-" : "v"}</div>;
}

function TelemetryProbe() {
  const reading = useTelemetry("vessel.flight");
  return <div data-testid="reading">{reading.state}</div>;
}

describe("a point read holds up its reckoner's declared inputs", () => {
  it("subscribes the elected reckoner's deps for a lone useStream read", () => {
    const fixture = buildFixture();

    render(
      <fixture.Provider>
        <StreamProbe topic="vessel.flight.altitudeAsl" />
      </fixture.Provider>,
    );

    // The read's own wire topic: the field resolves to the parent record.
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    // `vessel.flight`'s reckoner declares both of these, and nothing else on
    // this screen is reading either.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);
  });

  it("releases them again when the read unmounts", () => {
    const fixture = buildFixture();

    const { unmount } = render(
      <fixture.Provider>
        <StreamProbe topic="vessel.flight.altitudeAsl" />
      </fixture.Provider>,
    );
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => unmount());

    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(false);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(false);
  });

  it("subscribes the deps for a canonical useTelemetry read", () => {
    const fixture = buildFixture();

    render(
      <fixture.Provider>
        <TelemetryProbe />
      </fixture.Provider>,
    );

    expect(screen.getByTestId("reading").textContent).toBeTruthy();
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);
  });

  it("subscribes the deps an UPLINK's model declares, on the same terms", () => {
    const fixture = buildFixture();
    // Registered exactly as an Uplink client registers one at module load: a
    // non-core owner, against a Topic core's reckoners say nothing about.
    registerReckoner("test.contact", "acme-uplink", {
      deps: ["test.temperature"],
      reckon: (point) => ({
        modelled: [
          { path: "relativePosition", basis: "linear-dead-reckoning" },
        ],
        reckon: () => point.payload,
      }),
    });

    try {
      render(
        <fixture.Provider>
          <StreamProbe topic="test.contact.relativePosition" />
        </fixture.Provider>,
      );

      expect(fixture.transport.isSubscribed("test.contact")).toBe(true);
      expect(fixture.transport.isSubscribed("test.temperature")).toBe(true);
    } finally {
      clearReckoners();
    }
  });

  it("subscribes nothing extra where the model declares no deps", () => {
    const fixture = buildFixture();

    render(
      <fixture.Provider>
        <StreamProbe topic="vessel.target" />
      </fixture.Provider>,
    );

    // Both core dead-reckoning models declare `deps: []`, and an empty
    // declaration has to leave the subscription set exactly as it was.
    expect(fixture.transport.isSubscribed("vessel.target")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(false);
  });
});
