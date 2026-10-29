import type { TopologyPart } from "@ksp-gonogo/core";
import { partShapeTopic } from "@ksp-gonogo/data";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import winglet from "./__fixtures__/shapes/R8winglet.json";
import { usePartShapes } from "./usePartShapes";

const parts = [
  { flightId: 1, shape: "R8winglet" },
  { flightId: 2, shape: "R8winglet" },
  { flightId: 3, shape: "fuelTank" },
  { flightId: 4 },
] as TopologyPart[];

function Probe() {
  const { shapes, sources } = usePartShapes(parts);
  return (
    <>
      {sources}
      <div>{`shapes:${[...shapes.keys()].join(",") || "none"}`}</div>
    </>
  );
}

describe("usePartShapes", () => {
  it("opens each kind of part's shape once and hands over each as it arrives", async () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <Probe />
      </TelemetryProvider>,
    );
    expect(screen.getByText("shapes:none")).toBeTruthy();
    expect(t.isSubscribed(partShapeTopic("R8winglet"))).toBe(true);
    expect(t.isSubscribed(partShapeTopic("fuelTank"))).toBe(true);

    act(() => {
      t.emit(partShapeTopic("R8winglet"), winglet);
    });
    await waitFor(() =>
      expect(screen.getByText("shapes:R8winglet")).toBeTruthy(),
    );
  });
});
