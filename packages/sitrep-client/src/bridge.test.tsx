import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useStream } from "./use-stream";

/**
 * The core proof that `TelemetryProvider` bridges the client into a live
 * `TimelineStore`, at the `@ksp-gonogo/sitrep-client` layer: given only a
 * `client`, the provider auto-builds a store, registers the production derived
 * channels on it, and feeds it from the client's wire, so a derived subtopic
 * such as `dv.currentStageResource.<name>` resolves through the SAME provider
 * a raw-topic `useStream` call works through.
 *
 * `dv.currentStageResource` is the production channel with two inputs, so it
 * is the one that can show the provider subscribing every input a derived read
 * needs rather than just the first.
 */

function LiquidFuel() {
  const fuelReading = useStream<Value<"units">>(
    "dv.currentStageResource.LiquidFuel",
  );
  const fuel =
    fuelReading.state === "observed" || fuelReading.state === "stale"
      ? fuelReading.value.magnitude
      : undefined;
  return <div>fuel:{fuel === undefined ? NULL_DISPLAY : String(fuel)}</div>;
}

describe("TelemetryProvider bridges client -> TimelineStore -> useStream for derived topics", () => {
  it("resolves a derived field through useStream, given only `client` (the store is auto-created)", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <LiquidFuel />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`fuel:${NULL_DISPLAY}`)).toBeTruthy();

    // Ref-counting: subscribing the derived topic must have
    // subscribed its declared INPUTS on the wire, never the (server-unknown)
    // derived topic name itself.
    expect(transport.isSubscribed("dv.stages")).toBe(true);
    expect(transport.isSubscribed("vessel.structure")).toBe(true);
    expect(transport.isSubscribed("dv.currentStageResource")).toBe(false);
    expect(transport.isSubscribed("dv.currentStageResource.LiquidFuel")).toBe(
      false,
    );

    act(() => {
      transport.emit("vessel.structure", { currentStage: 0 });
      transport.emit("dv.stages", [
        { stage: 0, resources: { LiquidFuel: { current: 360, max: 720 } } },
      ]);
    });

    // `TelemetryProvider` coalesces `beginFrame()` to the next animation
    // frame, so the derived read resolves one frame after the emits, not
    // synchronously.
    await waitFor(() => expect(screen.getByText("fuel:360")).toBeTruthy());

    // Unsubscribe symmetry: unmounting releases both ref-counted raw inputs.
    unmount();
    expect(transport.isSubscribed("dv.stages")).toBe(false);
    expect(transport.isSubscribed("vessel.structure")).toBe(false);
  });

  it("still resolves an ordinary raw (non-derived) topic exactly as before", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Raw() {
      const vReading = useStream<number>("v.raw");
      const v =
        vReading.state === "observed" || vReading.state === "stale"
          ? vReading.value
          : undefined;
      return <div>raw:{v ?? NULL_DISPLAY}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Raw />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`raw:${NULL_DISPLAY}`)).toBeTruthy();
    act(() => transport.emit("v.raw", 42));
    await waitFor(() => expect(screen.getByText("raw:42")).toBeTruthy());
  });
});
