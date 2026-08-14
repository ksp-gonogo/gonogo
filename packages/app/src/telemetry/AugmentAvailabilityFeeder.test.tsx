import { AugmentSlot, clearAugments, registerAugment } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality, type TopicId } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { AugmentAvailabilityFeeder } from "./AugmentAvailabilityFeeder";

// End-to-end proof of the availability injection the ui-kit seam relocation
// relies on: NOTHING mocked. A real augment declares `requires: "demomod"`;
// `<AugmentSlot>`'s gate reads ui-kit's availability store; the app's real
// `AugmentAvailabilityFeeder` reads the real `demomod.available` Topic off a
// real `TelemetryProvider` and writes presence into that store. The augment
// must stay hidden until the Domain announces over the stream, then appear,
// exactly as the old spine-read gate behaved.

afterEach(() => {
  cleanup();
  clearAugments();
});

describe("AugmentAvailabilityFeeder end-to-end gating", () => {
  it("keeps a demomod-gated augment hidden until demomod.available arrives on the stream, then renders it", async () => {
    registerAugment({
      id: "demomod-overlay",
      augments: "e2e-availability.slot",
      component: () => <div>scan-layer</div>,
      requires: "demomod",
      channels: ["demomod.available" as TopicId],
    });

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <DomainAvailabilityProvider>
          <AugmentAvailabilityFeeder />
          <AugmentSlot name="e2e-availability.slot" props={{}} />
        </DomainAvailabilityProvider>
      </TelemetryProvider>,
    );

    // Domain silent → feeder writes "unavailable" → augment gated out.
    expect(screen.queryByText("scan-layer")).toBeNull();

    // The mod announces over the real stream; the feeder mirrors presence into
    // the store and the slot composes the augment in.
    act(() => {
      transport.emit(
        "demomod.available",
        { available: true },
        { quality: Quality.Loaded, source: "demomod" },
      );
    });

    await waitFor(() => expect(screen.getByText("scan-layer")).toBeTruthy());
  });
});
