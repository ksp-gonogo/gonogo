/**
 * Browser entry for the Scanning render harness. esbuild bundles this into
 * probe.html; a Playwright driver mounts it via the `window.__renderScanning`
 * hook and screenshots #root for the per-engine visual-regression baselines
 * under this package's `visual-baselines/<engine>/scanning-widget/`.
 *
 * It mounts the REAL Scanning widget against a MockDataSource (wrapped in a
 * BufferedDataSource so late re-subscribes keep the seeded value), then
 * synchronously emits every key from the synthetic `kerbin-partial-scan`
 * fixture. Mirrors the shared components probe pattern (the harness the widget
 * used before it moved to `@gonogo/scansat`).
 *
 * NOTE: the Playwright driver + `visual-gate` script + CI job that consume this
 * entry still need to be ported from `@gonogo/components` scripts. The baselines
 * are preserved alongside; regenerate them on Linux via the update-baselines
 * workflow once the driver lands.
 */
// Side-effect import: the Scanning widget self-registers on module load.
import {
  DashboardItemContext,
  getComponent,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
  unregisterDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../src";

registerStockBodies();

interface Payload {
  fixture: Record<string, unknown>;
  config?: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

let root: Root | null = null;
let buffered: BufferedDataSource | null = null;

function teardown(): void {
  if (root) {
    root.unmount();
    root = null;
  }
  if (buffered) {
    try {
      unregisterDataSource(buffered.id);
    } catch {
      /* not registered */
    }
    buffered.disconnect();
    buffered = null;
  }
}

async function renderScanning(payload: Payload): Promise<void> {
  teardown();

  const keys = Object.keys(payload.fixture)
    .filter((k) => k !== "_meta")
    .map((key) => ({ key }));
  const source = new MockDataSource({ keys });
  buffered = new BufferedDataSource({ source, store: new MemoryStore() });
  registerDataSource(buffered);
  await buffered.connect();

  const def = getComponent("scanning");
  if (!def) throw new Error('Probe: widget "scanning" not registered');

  const el = document.getElementById("root");
  if (!el) throw new Error("no #root");
  el.style.width = `${payload.pxW}px`;
  el.style.height = `${payload.pxH}px`;
  root = createRoot(el);
  root.render(
    createElement(
      DashboardItemContext.Provider,
      { value: { instanceId: "probe" } },
      createElement(def.component, {
        config: payload.config ?? {},
        id: "probe",
      }),
    ),
  );

  for (const [key, value] of Object.entries(payload.fixture)) {
    if (key === "_meta") continue;
    source.emit(key, value);
  }

  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

(
  window as unknown as { __renderScanning: typeof renderScanning }
).__renderScanning = renderScanning;
