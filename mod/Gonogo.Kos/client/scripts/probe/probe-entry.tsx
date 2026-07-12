/**
 * Browser entry for the kOS render harness. esbuild bundles this into
 * probe.html; a Playwright driver mounts it via the `window.__renderKos` hook
 * and screenshots #root for the per-engine visual-regression baselines under
 * this package's `visual-baselines/<engine>/kos-processors-widget/`.
 *
 * It mounts a REAL kOS widget against a MockDataSource. kOS-feed widgets read
 * from a `"kos"` source and pull topic status via `useKosScriptStatus` →
 * `getTopicStatus` / `onTopicStatusChange`, so the probe registers a
 * `ProbeKosDataSource` (a MockDataSource subclass that adds those two methods,
 * returning a static healthy status) under `id: "kos"` and routes any fixture
 * key prefixed `kos.` to it. It is registered *unbuffered* — buffer-wrapping
 * would hide the topic-status methods so `useKosScriptStatus` would silently
 * fall back to the empty status. Mirrors the shared components probe pattern
 * (the harness the widget used before it moved to `@ksp-gonogo/kos`).
 *
 * NOTE: the Playwright driver + `visual-gate` script + CI job that consume this
 * entry still need to be ported from `@ksp-gonogo/components` scripts. The baselines
 * are preserved alongside; regenerate them on Linux via the update-baselines
 * workflow once the driver lands.
 */
import {
  DashboardItemContext,
  getComponent,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
  unregisterDataSource,
} from "@ksp-gonogo/core";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
// Side-effect import: every kOS widget self-registers on module load.
import "../../src";

registerStockBodies();

/**
 * MockDataSource that also speaks the centralised kOS compute topic-status
 * surface (`getTopicStatus` / `onTopicStatusChange`) that `useKosScriptStatus`
 * sniffs for. Returns a static healthy status for any topic so the
 * KosScriptFrame chrome renders "last good" recent + not paused + not erroring.
 */
class ProbeKosDataSource extends MockDataSource {
  private readonly lastValues = new Map<string, unknown>();

  emit(key: string, value: unknown): void {
    this.lastValues.set(key, value);
    super.emit(key, value);
  }

  subscribe(key: string, cb: (v: unknown) => void): () => void {
    const unsub = super.subscribe(key, cb);
    if (this.lastValues.has(key)) cb(this.lastValues.get(key));
    return unsub;
  }

  getTopicStatus() {
    return {
      lastGoodAt: Date.now(),
      scriptError: null,
      parseError: null,
      paused: false,
      running: false,
    };
  }

  onTopicStatusChange(): () => void {
    return () => {};
  }
}

interface Payload {
  widgetId: string;
  fixture: Record<string, unknown>;
  config?: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

let root: Root | null = null;
let kos: ProbeKosDataSource | null = null;

function teardown(): void {
  if (root) {
    root.unmount();
    root = null;
  }
  if (kos) {
    try {
      unregisterDataSource(kos.id);
    } catch {
      /* not registered */
    }
    kos.disconnect();
    kos = null;
  }
}

async function renderKos(payload: Payload): Promise<void> {
  teardown();

  const keys = Object.keys(payload.fixture)
    .filter((k) => !k.startsWith("_"))
    .map((key) => ({ key }));
  kos = new ProbeKosDataSource({ id: "kos", keys });
  registerDataSource(kos);
  await kos.connect();

  const def = getComponent(payload.widgetId);
  if (!def) {
    throw new Error(`Probe: widget "${payload.widgetId}" not registered`);
  }

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
        config: payload.config ?? def.defaultConfig ?? {},
        id: "probe",
      }),
    ),
  );

  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  for (const [key, value] of Object.entries(payload.fixture)) {
    if (key.startsWith("_")) continue;
    kos.emit(key, value);
  }
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

(window as unknown as { __renderKos: typeof renderKos }).__renderKos =
  renderKos;
