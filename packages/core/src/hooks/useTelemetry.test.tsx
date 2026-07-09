import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
} from "@gonogo/sitrep-client";
import { Quality } from "@gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataValue } from "./useDataValue";
import { useTelemetry } from "./useTelemetry";

// Minimal in-memory legacy DataSource — same shape as useDataValue.test.ts.
function makeSource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & {
    emit: (key: string, value: unknown) => void;
  } = {
    id,
    name: id,
    status: "connected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribe(key, cb) {
      if (!dataListeners.has(key)) dataListeners.set(key, new Set());
      dataListeners.get(key)?.add(cb);
      return () => dataListeners.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    emit(key, value) {
      dataListeners.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
  };
  return source;
}

const ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

beforeEach(() => clearRegistry());

describe("useTelemetry — canonical TopicId read", () => {
  it("reads a Topic's payload straight off the mounted TimelineStore, typed as TopicPayload<T>", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Orbit() {
      const orbit = useTelemetry("vessel.orbit");
      // Compile-time proof: the canonical overload resolves to the Topic's
      // payload type. A wrong payload type here would fail `typecheck`.
      const sma: number | undefined = orbit?.sma;
      return <div>sma:{sma === undefined ? "—" : String(sma)}</div>;
    }

    // No carriedChannels prop: the canonical Topic read does not consult the
    // migration-shim allowlist (it has no legacy fallback to protect).
    render(
      <TelemetryProvider client={client}>
        <Orbit />
      </TelemetryProvider>,
    );

    expect(screen.getByText("sma:—")).toBeTruthy();

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });

    // Provider coalesces beginFrame() to the next animation frame, so the read
    // resolves one frame after the emit rather than synchronously.
    await waitFor(() => expect(screen.getByText("sma:700000")).toBeTruthy());
  });

  it("returns undefined when no TelemetryProvider is mounted", () => {
    const { result } = renderHook(() => useTelemetry("vessel.orbit"));
    expect(result.current).toBeUndefined();
  });
});

describe("useTelemetry — legacy two-arg overload preserved", () => {
  it("still reads from a registered DataSource when given (dataSourceId, key)", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useTelemetry("data", "career.funds"));

    expect(result.current).toBeUndefined();
    act(() => source.emit("career.funds", 289_848));
    expect(result.current).toBe(289_848);
  });
});

describe("useDataValue — deprecated alias", () => {
  it("is the exact same function reference as useTelemetry", () => {
    expect(useDataValue).toBe(useTelemetry);
  });

  it("still works through the alias (legacy two-arg call)", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useDataValue("data", "career.funds"));
    act(() => source.emit("career.funds", 42));
    expect(result.current).toBe(42);
  });
});
