/**
 * Vantage-control probe entry: a ONE-OFF review-render driver for
 * `MissionBanner`/`VantageControl` (see `render-vantage-control.ts`), not a
 * registered widget or a routed screen, so it doesn't fit the shared
 * `probe-entry.tsx` (dashboard-widget registry) or `screen-entry.tsx`
 * (routed-screen) harnesses. `MissionBanner` is app chrome
 * (`packages/app/src/components/MissionBanner.tsx`), imported directly by
 * relative path: esbuild resolves its own `@ksp-gonogo/*` imports from
 * wherever THAT file lives, so this crosses the package boundary safely
 * without adding a components→app dependency.
 *
 * Exposes `window.__renderVantage(payload)`: builds a fresh
 * `TelemetryProvider`/`StubTransport` pair per call (so state never leaks
 * between shots), mounts `MissionBanner`, emits the requested
 * `commandCentre.roster` fixture once the control has subscribed, and
 * optionally clicks the trigger open before the driver screenshots.
 */

import { type Screen, ScreenProvider } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MissionBanner } from "../../../app/src/components/MissionBanner";

export interface VantageProbePayload {
  /** `commandCentre.roster` fixture to emit once mounted; omit for the
   *  before-any-sample-lands fallback state. */
  roster?: unknown[];
  /** Click the trigger open before the screenshot. */
  open?: boolean;
  /** Which screen to mount on. Defaults to `"main"`, the picker. */
  screen?: Screen;
  /** The vantage to stamp the roster frame with, which is what the station
   *  readout states. Omit to leave the readout with nothing to state. */
  observedVantage?: string;
}

let activeRoot: Root | null = null;

function rafTick(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderVantage(payload: VantageProbePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Vantage probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }

  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock();
  const store = new TimelineStore(clock);

  activeRoot = createRoot(root);
  activeRoot.render(
    createElement(
      TelemetryProvider,
      { client, store, carriedChannels: ["commandCentre.roster"] },
      createElement(
        ScreenProvider,
        { value: payload.screen ?? "main" },
        createElement(MissionBanner),
      ),
    ),
  );

  // Two frames: commit + let styled-components inject + ResizeObserver
  // settle, matching screen-entry.tsx's own mount recipe.
  await rafTick();
  await rafTick();
  await settle(120);

  if (payload.roster) {
    transport.emit(
      "commandCentre.roster",
      payload.roster,
      payload.observedVantage
        ? { vantage: payload.observedVantage }
        : undefined,
    );
    await rafTick();
    await settle(60);
  }

  if (payload.open) {
    const trigger = root.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"]',
    );
    if (!trigger) throw new Error("Vantage probe: trigger button not found");
    trigger.click();
    await rafTick();
    await settle(60);
  }
}

declare global {
  interface Window {
    __renderVantage: (payload: VantageProbePayload) => Promise<void>;
  }
}

window.__renderVantage = renderVantage;
