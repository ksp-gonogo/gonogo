import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useUplinkHealthFor } from "./useUplinkHealthFor";

function rosterPoint(
  uplinks: Array<{
    id: string;
    ownedPrefixes: string[];
    state: number;
    detail: string | null;
  }>,
) {
  return {
    uplinks: uplinks.map((u) => ({
      id: u.id,
      version: "1.0.0",
      available: true,
      reason: null,
      ownedPrefixes: u.ownedPrefixes,
      health: { state: u.state, detail: u.detail },
    })),
  };
}

function renderWithTransport(channels: readonly string[]) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = renderHook(() => useUplinkHealthFor(channels), {
    wrapper: ({ children }) => (
      <TelemetryProvider client={client} carriedChannels={["system.uplinks"]}>
        {children}
      </TelemetryProvider>
    ),
  });
  return { transport, ...view };
}

describe("useUplinkHealthFor", () => {
  it("reports no-channels when nothing is declared", () => {
    const { result } = renderWithTransport([]);
    expect(result.current).toEqual({ status: "no-channels" });
  });

  it("reports unresolved before system.uplinks has arrived", () => {
    const { result } = renderWithTransport(["kos.terminal.1"]);
    expect(result.current).toEqual({ status: "unresolved" });
  });

  it("resolves the owning uplink via prefix match", async () => {
    const { transport, result } = renderWithTransport(["kos.terminal.1"]);
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "kos",
            ownedPrefixes: ["kos.terminal."],
            state: 1,
            detail: "no active CPU selected",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "resolved",
        state: "degraded",
        detail: "no active CPU selected",
        ownerId: "kos",
      }),
    );
  });

  it("picks the LONGEST matching prefix, not the first registered", async () => {
    const { transport, result } = renderWithTransport(["kos.terminal.1"]);
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "kos", ownedPrefixes: ["kos."], state: 0, detail: null },
          {
            id: "kos-terminal-specialist",
            ownedPrefixes: ["kos.terminal."],
            state: 1,
            detail: "specialist degraded",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "resolved",
        ownerId: "kos-terminal-specialist",
      }),
    );
  });

  it("returns the WORST health across multiple declared channels with different owners", async () => {
    const { transport, result } = renderWithTransport([
      "kos.terminal.1",
      "comms.delay",
    ]);
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "kos", ownedPrefixes: ["kos."], state: 0, detail: null },
          {
            id: "comms",
            ownedPrefixes: ["comms."],
            state: 2,
            detail: "no comms backend elected",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "resolved",
        state: "unavailable",
        detail: "no comms backend elected",
        ownerId: "comms",
      }),
    );
  });

  it("reports unowned when no roster entry's ownedPrefixes match", async () => {
    const { transport, result } = renderWithTransport([
      "legacy.unmapped.topic",
    ]);
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "kos", ownedPrefixes: ["kos."], state: 0, detail: null },
        ]),
      ),
    );
    await waitFor(() => expect(result.current).toEqual({ status: "unowned" }));
  });
});
