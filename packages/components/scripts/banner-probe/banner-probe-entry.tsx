/**
 * Standalone probe for the AlarmBanner (app-level, not a dashboard
 * widget). Mounts the banner inside a stub AlarmHostContext seeded
 * with a payload-driven AlarmSnapshot, and inside the real
 * BannerStack so visual issues that depend on the stack's 48 px
 * height + overflow:hidden surface in screenshots.
 *
 * The banner is in @gonogo/app; this file lives in the components
 * scripts dir so its widget-render bundling pipeline can reuse the
 * existing probe.html / esbuild path. Cross-package imports via
 * relative path are fine for a test-only entry.
 */

import { BannerStack } from "@gonogo/ui";
import { createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AlarmBanner,
  FiredAlarmPills,
  SafetyMarginPill,
  UnscheduledWarpPill,
} from "../../../app/src/alarms/AlarmBanner";
import { AlarmHostProvider } from "../../../app/src/alarms/AlarmHostContext";
import type { AlarmHostService } from "../../../app/src/alarms/AlarmHostService";
import type {
  Alarm,
  AlarmSnapshot,
  AlarmWarpState,
} from "../../../app/src/alarms/types";

interface BannerProbePayload {
  /** Full AlarmSnapshot to render. */
  snapshot: AlarmSnapshot;
  /** Pixel width / height of the host viewport for the stack to render in. */
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

/** Minimal AlarmHostService stub — satisfies the surface the banner
 *  actually calls (snapshot / subscribe + the action methods).
 *  Action methods are no-ops; the probe verifies rendering, not
 *  interaction. */
class StubHost {
  private snap: AlarmSnapshot;
  private subscribers: Array<(s: AlarmSnapshot) => void> = [];

  constructor(snap: AlarmSnapshot) {
    this.snap = snap;
  }

  snapshot(): AlarmSnapshot {
    return this.snap;
  }

  subscribe(cb: (s: AlarmSnapshot) => void): () => void {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter((c) => c !== cb);
    };
  }

  acknowledgeAlarm(_id: string): void {}
  acknowledgeUnscheduledWarp(): void {}
  beginWarpTo(): void {}
  cancelWarpTo(): void {}
  setWarpSafetyMargin(_s: number): void {}
}

function BannerHarness({ snapshot }: { snapshot: AlarmSnapshot }) {
  // Recreate the stub host per snapshot so React re-subscribes on
  // payload change. Avoid the "stale snapshot" cache by passing the
  // host instance through state.
  const [host] = useState(() => new StubHost(snapshot));
  // Push updated snapshots when the prop changes — not strictly
  // needed for one-shot screenshots but lets the same root re-render
  // with a new payload without an unmount/mount cycle.
  useEffect(() => {
    (host as unknown as { snap: AlarmSnapshot }).snap = snapshot;
  }, [host, snapshot]);
  return createElement(
    AlarmHostProvider,
    { service: host as unknown as AlarmHostService },
    createElement(
      BannerStack,
      null,
      createElement(AlarmBanner, null),
      createElement(SafetyMarginPill, null),
      createElement(FiredAlarmPills, null),
      createElement(UnscheduledWarpPill, null),
    ),
  );
}

async function renderBanner(payload: BannerProbePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Banner probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.background = "var(--color-surface-app)";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(BannerHarness, { snapshot: payload.snapshot }),
  );
  // Two raf ticks + settle so the banner's slide-in animation lands
  // before the screenshot. The Wrap has a 320ms animation; settle
  // generously past it.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 400));
}

declare global {
  interface Window {
    __renderBanner: (payload: BannerProbePayload) => Promise<void>;
  }
}

window.__renderBanner = renderBanner;

// Re-exports so the harness types can stay in sync with the fixture
// authors (these get tree-shaken when the entry's only consumer is
// the probe page).
export type { Alarm, AlarmSnapshot, AlarmWarpState };
