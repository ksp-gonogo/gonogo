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
 * The second test was written expecting the early sample to be stored with its
 * quantities bare. It is not: it does not reach the store at all, and the probe
 * reads `blank`. Registering the Topic afterwards does not recover it. So the
 * cost of a sample beating its Uplink's registration is the whole sample, not
 * just its units, and it is asserted here as the measured behaviour rather than
 * the guessed one.
 *
 * Either way it is the reason `StationUplinkLoader` gates the Dashboard subtree
 * rather than rendering alongside it: nothing subscribes while that gate is
 * closed, so no sample can arrive early. The second test is what that sentence
 * buys, stated as the thing it prevents.
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

  it("drops a sample that lands before the registration, and registering does not recover it, which is what the Dashboard gate prevents", async () => {
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
    const afterEarlySample = screen.getByTestId("decoded").textContent;

    // Registering now is what the real client module load does, and it does
    // not reach back: the sample is gone, not merely undecoded.
    act(() => {
      registerBarePrimitiveTopic(EARLY_TOPIC);
      registerTopicUnits(EARLY_TOPIC, { depth: UNIT });
    });
    await waitFor(() =>
      expect(screen.getByTestId("carried").textContent).toBe("carried"),
    );
    expect(afterEarlySample).toBe("blank");
    expect(screen.getByTestId("decoded").textContent).toBe("blank");

    // A sample arriving AFTER the registration decodes, which is the ordering
    // the gate guarantees and the first test asserts directly.
    emit(transport, EARLY_TOPIC, 43);
    await waitFor(() =>
      expect(screen.getByTestId("decoded").textContent).toBe(`value:${UNIT}`),
    );

    view.unmount();
    await act(async () => {});
  });
});
