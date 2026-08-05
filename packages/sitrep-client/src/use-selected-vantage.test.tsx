import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useSelectedVantage } from "./use-selected-vantage";

function VantageProbe() {
  return <div>{`vantage:${useSelectedVantage()}`}</div>;
}

describe("useSelectedVantage", () => {
  it("defaults to ksc and re-renders when setVantage changes it", () => {
    const client = new TelemetryClient(new StubTransport());
    render(
      <TelemetryProvider client={client}>
        <VantageProbe />
      </TelemetryProvider>,
    );
    expect(screen.getByText("vantage:ksc")).toBeTruthy();

    act(() => {
      client.setVantage("ground:gs1");
    });
    expect(screen.getByText("vantage:ground:gs1")).toBeTruthy();
  });

  it("returns the default ksc with no provider mounted", () => {
    render(<VantageProbe />);
    expect(screen.getByText("vantage:ksc")).toBeTruthy();
  });
});
