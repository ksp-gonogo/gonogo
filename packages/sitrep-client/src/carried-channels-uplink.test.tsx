import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider, useCarriedChannels } from "./context";
import { StubTransport } from "./stub-transport";

/**
 * An Uplink's Topics reach the carried-channels allowlist because its client
 * package registered them, not because someone in the gonogo repo wrote them
 * down. The promotion list is first-party and always will be; an Uplink ships
 * on its own schedule and can never appear on it.
 */

function Probe({ onRender }: { onRender: (set: ReadonlySet<string>) => void }) {
  onRender(useCarriedChannels());
  return null;
}

describe("TelemetryProvider carries the Topics an Uplink registered", () => {
  it("promotes a Topic registered before the provider mounted", () => {
    registerBarePrimitiveTopic("acme.reactor");
    const client = new TelemetryClient(new StubTransport());
    let seen: ReadonlySet<string> | undefined;
    render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe onRender={(set) => (seen = set)} />
      </TelemetryProvider>,
    );
    expect(seen?.has("acme.reactor")).toBe(true);
  });

  it("promotes one registered afterwards, which is when a bundle loads", () => {
    const client = new TelemetryClient(new StubTransport());
    let seen: ReadonlySet<string> | undefined;
    render(
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Probe onRender={(set) => (seen = set)} />
      </TelemetryProvider>,
    );
    expect(seen?.has("acme.turbopump")).toBe(false);

    // An Uplink's bundle is imported at runtime, long after the provider
    // mounted. Reading the registry once at mount would leave its Topics
    // uncarried for the whole session.
    act(() => registerBarePrimitiveTopic("acme.turbopump"));

    expect(seen?.has("acme.turbopump")).toBe(true);
  });
});
