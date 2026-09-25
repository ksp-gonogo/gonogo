import { CommsDelaySource, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import {
  TelemetryProvider,
  useTelemetryStore,
  useViewClock,
  type ViewClockView,
} from "./context";
import { COMMS_DELAY_TOPIC, DelayAuthority } from "./delay-authority";
import { isOwnCraftVantage } from "./own-craft-vantage";
import { StubTransport } from "./stub-transport";

/** The craft the pilot is strapped into, spelled as `CrewedVesselSource` mints it. */
const CRAFT = "vessel:abc-123";

/** The ground's light-time to that craft, as `comms.delay` reports it to everyone. */
const GROUND_DELAY = 420;

describe("isOwnCraftVantage", () => {
  it("is true only when the selected vantage IS the craft the samples are about", () => {
    expect(isOwnCraftVantage(CRAFT, CRAFT)).toBe(true);
    expect(isOwnCraftVantage("ground:Kerbal Space Center", CRAFT)).toBe(false);
    expect(isOwnCraftVantage(CRAFT, "vessel:xyz-999")).toBe(false);
  });

  it("refuses two unknowns as a match", () => {
    // `Meta.Vantage` is "" at a connection sitting at no command centre, and a
    // subject that has not arrived is undefined. A bare `===` calls either pair
    // equal and hands a ground operator a live clock on a craft light-minutes
    // away.
    expect(isOwnCraftVantage(undefined, undefined)).toBe(false);
    expect(isOwnCraftVantage("", "")).toBe(false);
    expect(isOwnCraftVantage("", CRAFT)).toBe(false);
    expect(isOwnCraftVantage(CRAFT, "")).toBe(false);
    expect(isOwnCraftVantage(CRAFT, undefined)).toBe(false);
  });
});

describe("DelayAuthority own-craft override", () => {
  it("reports no delay while the session is at its own craft's vantage", () => {
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: value("s", GROUND_DELAY),
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(GROUND_DELAY);

    authority.setOwnCraftVantage(true);
    expect(authority.delaySeconds()).toBe(0);
  });

  it("HOLDS the measured reading through the override rather than discarding it", () => {
    // A vantage that moves back to the ground must report the last measured
    // light-time at once. Clearing it would make the operator wait a whole one
    // to re-learn a number the session already had.
    const authority = new DelayAuthority();
    authority.observe({
      oneWaySeconds: value("s", GROUND_DELAY),
      source: CommsDelaySource.SignalDelay,
    });
    authority.setOwnCraftVantage(true);
    authority.setOwnCraftVantage(false);

    expect(authority.delaySeconds()).toBe(GROUND_DELAY);
  });

  it("keeps taking readings while overridden, so the ground delay is current on return", () => {
    const authority = new DelayAuthority();
    authority.setOwnCraftVantage(true);
    authority.observe({
      oneWaySeconds: value("s", GROUND_DELAY),
      source: CommsDelaySource.SignalDelay,
    });
    expect(authority.delaySeconds()).toBe(0);

    authority.setOwnCraftVantage(false);
    expect(authority.delaySeconds()).toBe(GROUND_DELAY);
  });
});

/**
 * The acceptance case, over the auto-built store a production
 * `TelemetryProvider` mounts: the ONE `ViewClock`'s delay is what every widget
 * read, every media buffer and every command lead is sized from, so this is
 * the assertion the whole task is for.
 *
 * An explicit `store` prop is deliberately NOT used: that caller owns their
 * clock's delay wiring whole (the provider's own contract), so the override is
 * only wired onto the store the provider builds itself.
 */
describe("the pilot's view clock", () => {
  function mount() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    /*
     * The clock OBJECT is captured, never a rendered number: nothing makes a
     * component re-render when the delay changes (that is the point of the
     * authority being read per frame by the clock rather than through React),
     * so a value read during render would be the mount-time one forever.
     */
    let clock: ViewClockView | undefined;
    let store: ReturnType<typeof useTelemetryStore> | undefined;

    function ReadDelay() {
      clock = useViewClock();
      store = useTelemetryStore();
      return null;
    }
    function Wrapper({ children }: { children: ReactNode }) {
      return <TelemetryProvider client={client}>{children}</TelemetryProvider>;
    }

    const view = render(
      <Wrapper>
        <ReadDelay />
      </Wrapper>,
    );

    return {
      client,
      view,
      transport,
      delay: () => clock?.delaySeconds(),
      emitGroundDelay: () => {
        act(() => {
          transport.emit(COMMS_DELAY_TOPIC, {
            oneWaySeconds: GROUND_DELAY,
            source: CommsDelaySource.SignalDelay,
          });
        });
      },
      /**
       * Two samples a light-time apart, because one is not a timeline. The
       * confirmed edge sits a whole delay behind the newest sample, so a lone
       * point leaves `vessel.orbit` unreadable at view time and the craft
       * would be invisible to the gate for reasons that have nothing to do
       * with the vantage.
       *
       * `source` is the PAYLOAD's provenance, `null` for a sample carrying
       * none; `envelopeSource` is the Courier node the mod stamps beside it,
       * `"system"` for every non-fleet topic.
       */
      emitOrbitFrom: (source: string | null, envelopeSource = "system") => {
        act(() => {
          for (const validAt of [0, 2 * GROUND_DELAY]) {
            transport.emit(
              "vessel.orbit",
              {
                referenceBodyIndex: 1,
                sma: 700_000,
                ecc: 0.01,
                inc: 0,
                lan: 0,
                argPe: 0,
                meanAnomalyAtEpoch: 0,
                epoch: 10,
                mu: 3.5316e12,
                ...(source === null ? {} : { meta: { source, quality: 0 } }),
              },
              { validAt, deliveredAt: validAt, source: envelopeSource },
            );
          }
          store?.beginFrame();
        });
      },
      selectVantage: (id: string) => {
        act(() => {
          client.setVantage(id);
          store?.beginFrame();
        });
      },
    };
  }

  it("subscribes nothing until a vantage is chosen, then reads the subject", () => {
    // The host relay pulls a topic because a screen asked for it and for no
    // other reason (`SitrepPeerRelay.test.tsx`). A gate that read the subject
    // unconditionally put `vessel.orbit` on the wire for every session, which
    // is what this pins.
    const f = mount();
    expect(f.transport.isSubscribed("vessel.orbit")).toBe(false);

    f.selectVantage(CRAFT);

    expect(f.transport.isSubscribed("vessel.orbit")).toBe(true);
    f.view.unmount();
    f.client.dispose();
  });

  it("runs at zero once the session is pinned to the craft it is aboard", async () => {
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage(CRAFT);
    expect(f.delay()).toBe(GROUND_DELAY); // the subject has not arrived yet

    f.emitOrbitFrom(CRAFT);

    expect(f.delay()).toBe(0);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });

  it("names the craft from the sample's own provenance, never the envelope's", async () => {
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage(CRAFT);
    f.emitOrbitFrom("vessel:xyz-999", CRAFT);

    expect(f.delay()).toBe(GROUND_DELAY);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });

  it("holds the ground's light-time for a sample that names no craft", async () => {
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage(CRAFT);
    f.emitOrbitFrom(null, CRAFT);

    expect(f.delay()).toBe(GROUND_DELAY);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });

  it("leaves a ground operator's delay untouched, whatever centre they picked", async () => {
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage("ground:Kerbal Space Center");
    f.emitOrbitFrom(CRAFT);

    expect(f.delay()).toBe(GROUND_DELAY);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });

  it("does not zero on a vessel vantage that is not the craft being watched", async () => {
    // The relay a ground operator observes from is a centre like any other and
    // is still light-minutes from the craft on screen.
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage("vessel:relay-777");
    f.emitOrbitFrom(CRAFT);

    expect(f.delay()).toBe(GROUND_DELAY);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });

  it("returns to the ground's light-time when the pilot hands back to a centre", async () => {
    const f = mount();
    f.emitGroundDelay();
    f.selectVantage(CRAFT);
    f.emitOrbitFrom(CRAFT);
    expect(f.delay()).toBe(0);

    f.selectVantage("ground:Kerbal Space Center");

    expect(f.delay()).toBe(GROUND_DELAY);
    await act(async () => {});
    f.view.unmount();
    f.client.dispose();
  });
});
