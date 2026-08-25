import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useObservedVantage } from "./use-observed-vantage";

function VantageProbe() {
  return <div>{`observed:${useObservedVantage() ?? "none"}`}</div>;
}

function mount() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  client.subscribe("vessel.orbit", () => {});
  render(
    <TelemetryProvider client={client}>
      <VantageProbe />
    </TelemetryProvider>,
  );
  return {
    client,
    emit: (vantage: string) => {
      act(() => {
        transport.emit("vessel.orbit", {}, { vantage });
      });
    },
  };
}

describe("useObservedVantage", () => {
  it("is undefined until a frame names a vantage, then follows the frames", () => {
    const { emit } = mount();
    expect(screen.getByText("observed:none")).toBeTruthy();

    emit("ksc");
    expect(screen.getByText("observed:ksc")).toBeTruthy();

    emit("ground:gs1");
    expect(screen.getByText("observed:ground:gs1")).toBeTruthy();
  });

  it("ignores the meta vantage, which marks an exempt topic rather than a viewpoint", () => {
    const { emit } = mount();

    emit("ksc");
    // An instant-class topic is routed onto the meta vantage at subscribe time,
    // so its frames say the topic skips the delay, not that the session moved.
    emit("meta");
    expect(screen.getByText("observed:ksc")).toBeTruthy();
  });

  it("reports what the frames say rather than what this client asked for", () => {
    const { client, emit } = mount();

    emit("ground:gs1");
    // The two answer different questions, and a station is where they part
    // company: its own selection cannot move off the default while its frames
    // come from a host session that can be anywhere.
    expect(client.selectedVantage).toBe("ksc");
    expect(screen.getByText("observed:ground:gs1")).toBeTruthy();
  });

  it("returns undefined with no provider mounted", () => {
    render(<VantageProbe />);
    expect(screen.getByText("observed:none")).toBeTruthy();
  });
});
