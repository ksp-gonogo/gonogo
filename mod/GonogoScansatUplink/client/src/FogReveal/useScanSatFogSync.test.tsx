import "fake-indexeddb/auto";
import {
  clearFogRevealSources,
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import type { FogMaskCache } from "@ksp-gonogo/data";
import {
  FogMaskCacheProvider,
  FogMaskStore,
  useFogMaskCache,
} from "@ksp-gonogo/data";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import type { BodyDefinition } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCAN_TYPE, type SCANCoverageBitmap } from "../schema";
import { useScanSatFogSync } from "./useScanSatFogSync";

const BODY: BodyDefinition = { id: "Kerbin", name: "Kerbin", radius: 600000 };
const LAYER_ID = "scansat:AltimetryHiRes";

/** Fork-shaped bitmap with a single tile set, same shape used by scanCoverageSync.test.ts. */
function bitmapWithTile(ilon: number, ilat: number): SCANCoverageBitmap {
  const w = 360;
  const h = 180;
  const bits = new Uint8Array((w * h + 7) >> 3);
  const idx = ilon * h + ilat;
  bits[idx >> 3] |= 0x80 >> (idx & 7);
  let binary = "";
  for (let i = 0; i < bits.length; i++) binary += String.fromCharCode(bits[i]);
  return {
    width: w,
    height: h,
    type: SCAN_TYPE.AltimetryHiRes,
    bits: btoa(binary),
  };
}

function Harness({
  body,
  onCache,
}: {
  body: BodyDefinition | undefined;
  onCache: (cache: FogMaskCache | null) => void;
}) {
  useScanSatFogSync(body);
  const cache = useFogMaskCache();
  useEffect(() => {
    onCache(cache);
  }, [cache, onCache]);
  return null;
}

describe("useScanSatFogSync — real TelemetryClient subscribe path (no getDataSource)", () => {
  let legacySource: MockDataSource;
  let client: TelemetryClient;
  let transport: StubTransport;
  let store: FogMaskStore;
  let cache: FogMaskCache | null;
  const renderedTrees: Array<() => void> = [];

  beforeEach(() => {
    clearRegistry();
    // `scansat.available` still reads through the legacy `useDataValue("data", ...)`
    // gate at the top of the hook (untouched by this migration) — a MockDataSource
    // registered under the default "data" id lets the test flip it on.
    legacySource = new MockDataSource({
      id: "data",
      keys: [{ key: "scansat.available" }],
    });
    registerDataSource(legacySource);

    transport = new StubTransport();
    client = new TelemetryClient(transport);
    store = new FogMaskStore({ dbName: `gonogo-fog-test-${Math.random()}` });
    cache = null;
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearFogRevealSources();
  });

  function renderHarness(body: BodyDefinition | undefined) {
    const result = render(
      <TelemetryProvider client={client}>
        <FogMaskCacheProvider store={store}>
          <Harness
            body={body}
            onCache={(c) => {
              cache = c;
            }}
          />
        </FogMaskCacheProvider>
      </TelemetryProvider>,
    );
    renderedTrees.push(result.unmount);
    return result;
  }

  it("subscribes to scansat.mask.<body>.<type> on the real TelemetryClient once scansat.available flips true, and merges an arriving bitmap into the fog mask", async () => {
    renderHarness(BODY);
    act(() => {
      legacySource.emit("scansat.available", true);
    });

    const key = `scansat.mask.${BODY.name}.${SCAN_TYPE.AltimetryHiRes}`;
    await waitFor(() => expect(transport.isSubscribed(key)).toBe(true));

    act(() => {
      transport.emit(key, bitmapWithTile(180, 90));
    });

    await waitFor(() => {
      const mask = cache?.get(BODY.id, LAYER_ID);
      expect(mask).toBeDefined();
      if (!mask) return;
      // ilon=180, ilat=90 (no axis offset) lands at the mask's centre pixel.
      expect(mask.data[511 * mask.width + 1024]).toBe(255);
    });
  });

  it("never subscribes while scansat.available stays false (unchanged gate behaviour)", async () => {
    renderHarness(BODY);
    const key = `scansat.mask.${BODY.name}.${SCAN_TYPE.AltimetryHiRes}`;
    // Give any (incorrect) eager subscription a chance to happen.
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport.isSubscribed(key)).toBe(false);
  });

  it("tears down the mask subscription when the widget unmounts", async () => {
    const { unmount } = renderHarness(BODY);
    act(() => {
      legacySource.emit("scansat.available", true);
    });
    const key = `scansat.mask.${BODY.name}.${SCAN_TYPE.AltimetryHiRes}`;
    await waitFor(() => expect(transport.isSubscribed(key)).toBe(true));

    unmount();
    renderedTrees.length = 0; // already unmounted above, don't double-unmount in afterEach

    expect(transport.isSubscribed(key)).toBe(false);
  });
});
