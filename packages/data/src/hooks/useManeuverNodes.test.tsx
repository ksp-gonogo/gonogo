import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { ManeuverNode } from "@ksp-gonogo/sitrep-sdk";
import type { WireOf } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useManeuverNodes } from "./useManeuverNodes";

/**
 * A node as the mod SENDS it, quantities still bare numbers: `emit` wraps them
 * on the way in, so the modelled `ManeuverNode` is the shape that comes out the
 * far end, not the one handed to the transport.
 */
function fakeWireNode(
  partial: Partial<WireOf<ManeuverNode>> & { id: string; ut: number },
): WireOf<ManeuverNode> {
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
 * `useManeuverNodes` reads the `vessel.maneuver` wire topic through
 * `useStream`, so these tests drive the real
 * `TelemetryProvider`/`TelemetryClient` pipeline by emitting that topic,
 * rather than standing a `MockDataSource` under the id `"data"`.
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

  it("carries each node's own id, not its position in the list", async () => {
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
    // The ids the update and remove commands address these nodes by. A
    // position would read as 0 and 1 here and resolve to nothing on the craft.
    expect(last?.[0]).toMatchObject({
      id: "a",
      UT: 100,
      deltaVMagnitude: 5,
    });
    expect(last?.[1]).toMatchObject({
      id: "b",
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
