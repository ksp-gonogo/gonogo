import { useTelemetry } from "@ksp-gonogo/sitrep-sdk/spine";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import {
  clearReckoners,
  registerCoreReckoners,
  registerReckoner,
} from "./reckoners";
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

const SUBJECT = "8f0d2d3c-0000-4000-8000-000000000001";

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
  "comms.delay",
  "comms.path",
  "commandCentre.roster",
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
  const valueReading = useStream<unknown>(topic);
  const value =
    valueReading.state === "observed" || valueReading.state === "stale"
      ? valueReading.value
      : undefined;
  return <div data-testid="probe">{value === undefined ? "-" : "v"}</div>;
}

function CommsDelayProbe() {
  const reading = useTelemetry("comms.delay");
  return <div data-testid="delay">{reading.state}</div>;
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

  /**
   * A PER-SUBJECT dep, which is the one kind `subscribeTopicRead` structurally
   * cannot hold up: its topic is a function of data that arrives after the read
   * mounts, so the read's set was resolved before the topic existed. The store
   * resolves the subject and therefore the store holds it up, and this asserts
   * that reaches the WIRE rather than stopping at the store.
   *
   * Written against the transport for the reason this whole file is: the store
   * half of this passes with the provider unwired, because a test that ingests
   * directly never asks whether anyone subscribed. That is exactly how this was
   * nearly shipped half-built.
   */
  it("subscribes a per-subject dep's resolved topic, once the subject arrives", () => {
    const fixture = buildFixture();
    /*
     * Explicit, because this fixture passes its OWN store and the provider only
     * registers core's models when it builds one itself. The other tests here
     * never noticed: `vessel.flight`'s deps reach the wire through the derived
     * channel's declared `inputs`, which is the other half of
     * `subscribeTopicRead` and needs no reckoner at all.
     */
    registerCoreReckoners();

    render(
      <fixture.Provider>
        <CommsDelayProbe />
      </fixture.Provider>,
    );

    // Nothing has named a relay yet, so nothing dynamic is held.
    expect(fixture.transport.isSubscribed(`fleet.${SUBJECT}.orbit`)).toBe(
      false,
    );

    act(() => {
      // Every FIXED dep, because the resolve loop declines on the first one
      // missing and never reaches the subject pass. That ordering is
      // deliberate: there is no sense holding a topic up for a model that is
      // not going to run.
      fixture.transport.emit("system.bodies", { bodies: [] });
      fixture.transport.emit("commandCentre.roster", []);
      fixture.transport.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: { magnitude: 2_000_000 },
        ecc: { magnitude: 0 },
        inc: { magnitude: 0 },
        lan: { magnitude: 0 },
        argPe: { magnitude: 0 },
        meanAnomalyAtEpoch: { magnitude: 0 },
        epoch: { magnitude: 0 },
        mu: { magnitude: 3.5316e12 },
        horizon: { kind: 1, trajectoryKind: 1 },
      });
      fixture.transport.emit("comms.delay", {
        oneWaySeconds: { magnitude: 1 },
        source: 1,
      });
      fixture.transport.emit("comms.path", {
        hops: [
          {
            from: "craft",
            to: SUBJECT,
            fromIsHome: false,
            toIsHome: false,
            kind: 1,
            distanceMeters: { magnitude: 1000 },
          },
        ],
      });
      fixture.store.beginFrame();
    });

    expect(fixture.transport.isSubscribed(`fleet.${SUBJECT}.orbit`)).toBe(true);
    clearReckoners();
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
