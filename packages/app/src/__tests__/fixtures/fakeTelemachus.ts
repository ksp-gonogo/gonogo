import { MockDataSource, registerDataSource } from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act } from "@ksp-gonogo/test-utils";

/**
 * Stands in for a real `TelemachusDataSource` wrapped in a real
 * `BufferedDataSource`, for tests that deliberately exercise the LEGACY
 * `useDataValue("data", key)` shim branch (no `TelemetryProvider` mounted —
 * see `map-topic.ts`'s doc comment on why that branch survives P4c-b: the
 * mapped+carried resolution never touches the actual `DataSource` instance,
 * but a genuinely-unmapped key, or a test that mounts no stream Provider at
 * all, still falls through to `getDataSource("data")`).
 *
 * Built on `@ksp-gonogo/core`'s `MockDataSource` (an in-memory fake — no
 * WS/HTTP round trip) instead of the real WS-based Telemachus client, which
 * was deleted alongside `packages/app/src/dataSources/telemachus.ts`. Toggle
 * actions (`f.<x>`) flip `v.<x>Value` and push the new value, mirroring the
 * real Telemachus Reborn action/value key convention closely enough for
 * ActionGroup-style golden tests.
 */
export interface FakeTelemachusHandle {
  telemachus: MockDataSource;
  buffered: BufferedDataSource;
  state: Record<string, unknown>;
  /** Every `f.<x>` execute call seen, in order. */
  executedActions: string[];
  /**
   * Push every currently-tracked key/value to subscribers, wrapped in
   * `act()`. Call this AFTER the consuming widget has rendered/mounted —
   * mirrors the real source's "push current state right after the WS '+'
   * subscribe message" round trip.
   */
  seed(): void;
  /** Update one key's value and push it, wrapped in `act()`. */
  push(key: string, value: unknown): void;
}

export async function setupFakeTelemachus(
  initialState: Record<string, unknown> = {},
): Promise<FakeTelemachusHandle> {
  const state: Record<string, unknown> = {
    // Default to a healthy CommNet link so BufferedDataSource's signal gate
    // doesn't drop antenna-gated keys (v.*Value etc.) — see
    // BufferedDataSource.handleSample's comm.connected trust-gate tracker.
    "comm.connected": true,
    ...initialState,
  };
  const executedActions: string[] = [];

  const telemachus: MockDataSource = new MockDataSource({
    id: "telemachus",
    affectedBySignalLoss: true,
    onExecute: (action) => {
      executedActions.push(action);
      const base = action.replace(/^f\./, "");
      const valueKey = `v.${base}Value`;
      state[valueKey] = !(state[valueKey] as boolean);
      act(() => {
        telemachus.emit(valueKey, state[valueKey]);
      });
    },
  });
  registerDataSource(telemachus);

  const buffered = new BufferedDataSource({
    source: telemachus,
    store: new MemoryStore(),
  });
  registerDataSource(buffered);

  await telemachus.connect();
  await buffered.connect();

  const seed = () => {
    act(() => {
      for (const [key, value] of Object.entries(state)) {
        telemachus.emit(key, value);
      }
    });
  };
  const push = (key: string, value: unknown) => {
    state[key] = value;
    act(() => {
      telemachus.emit(key, value);
    });
  };

  return { telemachus, buffered, state, executedActions, seed, push };
}
