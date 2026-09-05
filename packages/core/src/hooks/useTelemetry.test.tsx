import {
  type Reading,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
  type WireOf,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import { useLegacyTelemetry } from "../test/legacyTelemetry";
import type { DataSource, DataSourceStatus } from "../types";
import { useTelemetry } from "./useTelemetry";

// Minimal in-memory legacy DataSource: same shape as useTelemetry.legacy-datasource.test.ts.
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

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

const ORBIT: WireOf<VesselOrbitPayload> = {
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

describe("useTelemetry: canonical TopicId read", () => {
  it("reads a Topic straight off the mounted TimelineStore, typed as Reading<TopicPayload<T>>", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Orbit() {
      const orbit = judgeable(useTelemetry("vessel.orbit"));
      // Compile-time proof: the canonical overload resolves to a `Reading` of the
      // Topic's payload, and `judgeable` narrows it back to the payload. A wrong
      // payload type here would fail `typecheck`.
      // `.magnitude`: `sma` is a declared length, so the decode hands the
      // widget a `Value`. The probe prints the number to keep the assertion
      // about the read path rather than about rendering.
      const sma: number | undefined = orbit?.sma.magnitude;
      return <div>sma:{sma === undefined ? NULL_DISPLAY : String(sma)}</div>;
    }

    // No carriedChannels prop: the canonical Topic read does not consult the
    // migration-shim allowlist (it has no legacy fallback to protect).
    render(
      <TelemetryProvider client={client}>
        <Orbit />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`sma:${NULL_DISPLAY}`)).toBeTruthy();

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

  it("answers `pending` when no TelemetryProvider is mounted", () => {
    // Not `undefined`: "there is no stream here" and "the stream has told us
    // nothing yet" are the same statement from a widget's point of view, and both
    // are the `pending` arm. A widget on a station with no host reads exactly what a
    // widget waiting for its first frame reads, which is the honest answer.
    const { result } = renderHook(() => useTelemetry("vessel.orbit"));
    expect(result.current).toEqual({ state: "pending", reckoning: "none" });
  });
});

describe("useTelemetry: legacy two-arg overload preserved", () => {
  it("still reads from a registered DataSource when given (dataSourceId, key)", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useLegacyTelemetry("data", "career.funds"),
    );

    expect(result.current).toBeUndefined();
    act(() => source.emit("career.funds", 289_848));
    expect(result.current).toBe(289_848);
  });
});
