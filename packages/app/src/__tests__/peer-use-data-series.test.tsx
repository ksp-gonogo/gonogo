import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { useDataSeries } from "@ksp-gonogo/data";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { PeerClientService } from "../peer/PeerClientService";

/**
 * End-to-end check that `useDataSeries` works on a station: it should
 * backfill via the peer `queryRange` path, then keep appending as
 * `subscribeSamples` fires. Proves the Phase 7 plumbing lines up with the
 * hook's expectations — after this, Phase 8's find-and-replace is safe.
 */

function makeFakeClient(backfill: { t: number[]; v: unknown[] }) {
  let dataCb:
    | ((sourceId: string, key: string, value: unknown, t: number) => void)
    | null = null;
  const fake: Partial<PeerClientService> = {
    onData: (cb) => {
      dataCb = cb;
      return () => {
        dataCb = null;
        return true;
      };
    },
    onSourceStatus: () => () => true,
    sendExecute: vi.fn(),
    sendQueryRange: vi.fn(async () => backfill),
  };
  return {
    service: fake as unknown as PeerClientService,
    emitData: (sourceId: string, key: string, value: unknown, t: number) =>
      dataCb?.(sourceId, key, value, t),
  };
}

function LastValue({ sourceId, k }: { sourceId: "data"; k: string }) {
  const range = useDataSeries(sourceId, k, 60);
  const lastT = range.t[range.t.length - 1];
  const lastV = range.v[range.v.length - 1];
  return (
    <div data-testid="series">
      {String(lastT ?? "-")}|{String(lastV ?? "-")}|len={range.t.length}
    </div>
  );
}

describe("useDataSeries against PeerClientDataSource", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    // Unmount before clearing so the registry-change listener inside
    // useDataSourceSubscription doesn't fire a setState into a still-
    // mounted component (which would land outside any act() scope).
    cleanup();
    clearRegistry();
  });

  it("backfills from queryRange and keeps appending live samples", async () => {
    const client = makeFakeClient({ t: [1000, 2000], v: [10, 20] });
    const source = new PeerClientDataSource("data", "Data", client.service);
    registerDataSource(source);

    const rendered = render(<LastValue sourceId="data" k="v.altitude" />);

    // queryRange backfill — awaited in a microtask inside the hook.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.getByTestId("series").textContent).toBe("2000|20|len=2");

    // Live sample arrives.
    await act(async () => {
      client.emitData("data", "v.altitude", 30, 3000);
      await Promise.resolve();
    });

    expect(rendered.getByTestId("series").textContent).toBe("3000|30|len=3");
  });

  it("propagates queryRange rejection without crashing the hook", async () => {
    const rejecting: Partial<PeerClientService> = {
      onData: () => () => true,
      onSourceStatus: () => () => true,
      sendExecute: vi.fn(),
      sendQueryRange: vi.fn(async () => {
        throw new Error("peer closed");
      }),
    };
    const source = new PeerClientDataSource(
      "data",
      "Data",
      rejecting as unknown as PeerClientService,
    );
    registerDataSource(source);

    const rendered = render(<LastValue sourceId="data" k="v.altitude" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No backfill, no samples — empty state.
    expect(rendered.getByTestId("series").textContent).toBe("-|-|len=0");
  });
});
