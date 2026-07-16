import {
  type ManeuverNodeWirePayload,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useManeuverNodes } from "./useManeuverNodes";

function fakeWireNode(
  partial: Partial<ManeuverNodeWirePayload> & { id: string; ut: number },
): ManeuverNodeWirePayload {
  return {
    patches: [],
    ...partial,
  };
}

function Probe({
  onRender,
}: {
  onRender: (nodes: ReturnType<typeof useManeuverNodes>) => void;
}) {
  const nodes = useManeuverNodes();
  onRender(nodes);
  return null;
}

/**
 * `useManeuverNodes` reads the `vessel.maneuver.legacy` derived channel
 * (`maneuver-legacy.ts`, reshaping the raw `vessel.maneuver` wire topic) via
 * `useStream` — the retired `("data", "o.maneuverNodes")` shim read never had
 * a live legacy `DataSource` behind it in production, so these tests exercise
 * the real `TelemetryProvider`/`TelemetryClient` stream pipeline (emitting raw
 * `vessel.maneuver`) instead of a `MockDataSource` under id `"data"`.
 */
describe("useManeuverNodes", () => {
  function renderProbe() {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const renders: Array<ReturnType<typeof useManeuverNodes>> = [];
    render(
      <TelemetryProvider client={client}>
        <Probe onRender={(n) => renders.push(n)} />
      </TelemetryProvider>,
    );
    return { transport, renders };
  }

  it("returns an empty array when no nodes are present", async () => {
    const { transport, renders } = renderProbe();
    act(() => transport.emit("vessel.maneuver", { nodes: [] }));
    await waitFor(() => expect(renders.at(-1)).toEqual([]));
  });

  it("parses nodes and derives deltaVMagnitude + id", async () => {
    const { transport, renders } = renderProbe();
    act(() =>
      transport.emit("vessel.maneuver", {
        nodes: [
          fakeWireNode({
            id: "a",
            ut: 100,
            dvRadial: 3,
            dvNormal: 4,
            dvPrograde: 0,
          }),
          fakeWireNode({
            id: "b",
            ut: 200,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 12,
          }),
        ],
      }),
    );

    await waitFor(() => expect(renders.at(-1)).toHaveLength(2));
    const last = renders.at(-1);
    expect(last?.[0]).toMatchObject({
      id: 0,
      UT: 100,
      deltaVMagnitude: 5,
    });
    expect(last?.[1]).toMatchObject({
      id: 1,
      UT: 200,
      deltaVMagnitude: 12,
    });
  });

  it("returns a new list when the underlying array changes", async () => {
    const { transport, renders } = renderProbe();
    act(() =>
      transport.emit("vessel.maneuver", {
        nodes: [fakeWireNode({ id: "a", ut: 10, dvRadial: 1 })],
      }),
    );
    await waitFor(() => expect(renders.at(-1)).toHaveLength(1));
    const first = renders.at(-1);

    act(() =>
      transport.emit("vessel.maneuver", {
        nodes: [
          fakeWireNode({ id: "a", ut: 10, dvRadial: 1 }),
          fakeWireNode({ id: "b", ut: 20, dvNormal: 2 }),
        ],
      }),
    );
    await waitFor(() => expect(renders.at(-1)).toHaveLength(2));
    const second = renders.at(-1);
    expect(second).not.toBe(first);
  });
});
