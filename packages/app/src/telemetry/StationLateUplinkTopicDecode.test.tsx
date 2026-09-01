import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useCarriedChannels,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  isValue,
  registerBarePrimitiveTopic,
  registerTopicUnits,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { type ReactNode, useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

/**
 * A station reads an Uplink's WIRE Topic, decoded, when that Uplink registered
 * after the provider mounted.
 *
 * This is the sibling of `StationLateContributedChannels.test.tsx`, which asks
 * the same station-ordering question about a DERIVED channel. It is here
 * because the ordering stopped being hypothetical on 2026-08-31: until then
 * nine Uplink clients were statically imported by `main.tsx`, so on a station
 * their Topics and units were registered at BOOT, before any provider existed,
 * and only the two runtime-loaded ones took the late path. Those imports are
 * gone and every Uplink now registers when its bundle loads, which on a
 * station is post-connect, inside `StationUplinkLoader`.
 *
 * The justification given for those imports, four times over, was that "a
 * station has to know <topic> is a Topic to read it off the host at all". This
 * asserts what actually happens, in the order a station actually does it.
 *
 * ## Why the unit half needs its own test
 *
 * `carried-channels-uplink.test.tsx` already proves the PROMOTION half: a Topic
 * registered after mount reaches the carried-channels allowlist. Promotion is
 * not the whole read. `TelemetryClient` calls `wrapTopicPayload` at MESSAGE
 * INGEST (`sitrep-sdk/src/client.ts`), which reads the unit registry live, so
 * whether a quantity is a `Value` or a bare number is settled once, when the
 * sample lands, and nothing re-decodes it afterwards. That is a different
 * failure from an uncarried Topic and no existing test covered it.
 *
 * ## What the early-sample case actually does, measured
 *
 * The early sample is STORED, with its quantities bare. `useStream`'s subscribe
 * is not gated on the carried allowlist, so the frame reaches the store whether
 * or not anything has registered the Topic; what it misses is the unit lookup
 * `wrapTopicPayload` does at ingest. Registering afterwards does not re-decode
 * it, and the value stays bare until the next sample for that Topic arrives. So
 * the cost of a sample beating its Uplink's registration is that sample's
 * units, for as long as it is the newest one.
 *
 * That is the reason `StationUplinkLoader` gates the Dashboard subtree rather
 * than rendering alongside it: nothing subscribes while that gate is closed, so
 * no sample can arrive early and no widget is handed a bare number where its
 * type says `Value`. The second test is what that sentence buys, stated as the
 * thing it prevents.
 *
 * ## Why the second test waits for every reading it asserts
 *
 * A value the store ingests mid-frame does not surface until the provider's
 * next `beginFrame()`: `TimelineStore.sample` is memoized per frame token, and
 * `TelemetryProvider` coalesces ingests onto an animation frame. A synchronous
 * read straight after an emit therefore reads `blank` for a sample that is
 * already stored, and flips as soon as anything in the test body awaits long
 * enough for a frame to tick. An earlier version of this file asserted that
 * transient and read it as a dropped sample; it passed locally and failed in CI
 * on nothing but machine load.
 */

/*
 * A fictional Uplink, so this app-side file names no mod. Two Topics because
 * the SDK's registries are module-global and a file shares them across its
 * tests: the second test needs one nothing has registered yet.
 */
const TOPIC = "acmereactor.coolant";
const EARLY_TOPIC = "acmereactor.pressure";
const UNIT = "m";

function Probe({ topic = TOPIC }: { topic?: string }) {
  const reading = useStream<{ depth: unknown }>(topic);
  const carried = useCarriedChannels().has(topic);
  const depth = reading?.depth;
  return (
    <div>
      <span data-testid="carried">{carried ? "carried" : "not-carried"}</span>
      <span data-testid="decoded">
        {depth === undefined
          ? "blank"
          : isValue(depth)
            ? `value:${depth.unit}`
            : `bare:${typeof depth}`}
      </span>
    </div>
  );
}

/**
 * Stands in for `StationUplinkLoader`: registers on mount and gates its
 * children until it has, which is the order the real loader imposes by not
 * rendering the Dashboard until `loadEnabledUplinks` resolves.
 */
function LateLoader({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    registerBarePrimitiveTopic(TOPIC);
    registerTopicUnits(TOPIC, { depth: UNIT });
    setLoaded(true);
  }, []);
  return loaded ? children : null;
}

function emit(transport: StubTransport, topic: string, depth: number): void {
  const pastUt = Date.now() / 1000 - 10_000;
  act(() => {
    transport.emit(topic, { depth }, { validAt: pastUt, deliveredAt: pastUt });
  });
}

/**
 * Holds the act scope open across several of the provider's animation-frame
 * ticks, so an assertion that a reading has NOT changed is about a settled
 * state rather than about a frame that had not been minted yet. A `waitFor`
 * cannot express this: there is no change to wait for, and the whole point is
 * that none arrives.
 */
async function settleFrames(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe("a station's Uplink registers its wire Topic after the store is built", () => {
  it("carries the Topic and decodes its quantity, registered after the provider mounted", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const view = render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <LateLoader>
          <Probe />
        </LateLoader>
      </TelemetryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("carried")).toBeTruthy());
    expect(screen.getByTestId("carried").textContent).toBe("carried");

    emit(transport, TOPIC, 42);

    await waitFor(() =>
      expect(screen.getByTestId("decoded").textContent).toBe(`value:${UNIT}`),
    );

    view.unmount();
    await act(async () => {});
  });

  it("stores a sample that lands before the registration with its quantities bare, and registering does not re-decode it, which is what the Dashboard gate prevents", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    /*
     * No LateLoader: the sample arrives while the Topic is entirely unknown,
     * exactly the state a station would be in if its Dashboard mounted
     * alongside `StationUplinkLoader` instead of behind it.
     */
    const view = render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe topic={EARLY_TOPIC} />
      </TelemetryProvider>,
    );

    emit(transport, EARLY_TOPIC, 42);

    /*
     * The sample reaches the store even though nothing has registered the
     * Topic, and it lands bare: the unit lookup happens once, at ingest.
     * Waited for rather than read synchronously, because a mid-frame ingest
     * only surfaces on the provider's next `beginFrame()`.
     */
    await waitFor(() =>
      expect(screen.getByTestId("decoded").textContent).toBe("bare:number"),
    );

    // Registering now is what the real client module load does.
    act(() => {
      registerBarePrimitiveTopic(EARLY_TOPIC);
      registerTopicUnits(EARLY_TOPIC, { depth: UNIT });
    });
    await waitFor(() =>
      expect(screen.getByTestId("carried").textContent).toBe("carried"),
    );

    // It does not reach back. Nothing re-walks a payload the store already
    // holds, so the stored sample is still bare frames after the registration.
    await settleFrames();
    expect(screen.getByTestId("decoded").textContent).toBe("bare:number");

    // Only a sample arriving AFTER the registration decodes, which is the
    // ordering the gate guarantees and the first test asserts directly.
    emit(transport, EARLY_TOPIC, 43);
    await waitFor(() =>
      expect(screen.getByTestId("decoded").textContent).toBe(`value:${UNIT}`),
    );

    view.unmount();
    await act(async () => {});
  });
});
