/**
 * Alarms-modal probe entry: a review-render driver for the "Fires on" vantage
 * control in `AlarmsModal` (see `render-alarms-vantage.ts`). Not a registered
 * widget and not a routed screen, so it gets its own entry rather than the
 * shared `probe-entry.tsx` / `screen-entry.tsx` harnesses, the same way
 * `vantage-control-probe` does.
 *
 * `AlarmsModal` is app chrome (`packages/app/src/alarms/AlarmsModal.tsx`),
 * imported by relative path: esbuild resolves that file's own
 * `@ksp-gonogo/*` imports from where it lives, so nothing here adds a
 * components -> app dependency.
 *
 * Exposes `window.__renderAlarms(payload)`: builds a fresh
 * `TelemetryProvider`/`StubTransport` pair per call so no state leaks between
 * shots, mounts the modal at a light-time where the two clocks genuinely
 * differ, and selects the requested trigger kind before the driver
 * screenshots.
 */

import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { AlarmsModal } from "../../../app/src/alarms/AlarmsModal";
import type { AlarmSnapshot } from "../../../app/src/alarms/types";

export interface AlarmsProbePayload {
  /** Which trigger kind the draft form is on. Defaults to the modal's own default, `time`. */
  kind?: "time" | "threshold";
  /** One-way light time the view clock is offset by, seconds. */
  owltSeconds?: number;
}

const SNAPSHOT: AlarmSnapshot = {
  alarms: [],
  ut: 1_000,
  warp: { index: 0, rate: 1, mode: "UNKNOWN" },
  unscheduledWarp: null,
  warpTo: null,
  warpSafetyMarginSeconds: 10,
};

let activeRoot: Root | null = null;

function rafTick(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderAlarms(payload: AlarmsProbePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Alarms probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }

  const owlt = payload.owltSeconds ?? 252;
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: () => 0,
    warpRate: () => 1,
    delaySeconds: () => owlt,
  });
  const store = new TimelineStore(clock);
  client.attachStore(store);

  activeRoot = createRoot(root);
  activeRoot.render(
    /* The modal composes ui-kit primitives, which read design tokens off the
       styled-components theme (`theme.space.md` in `Stack`): without a provider
       the theme is `{}` and those reads throw. */
    createElement(
      ThemeProvider,
      { theme: defaultDarkTheme },
      createElement(
        TelemetryProvider,
        {
          client,
          store,
          carriedChannels: new Set(["vessel.control", "commandCentre.roster"]),
        },
        createElement(AlarmsModal, {
          useSnapshot: () => SNAPSHOT,
          onAdd: () => {},
          onUpdate: () => {},
          onDelete: () => {},
        }),
      ),
    ),
  );

  await rafTick();
  await settle(60);

  if (payload.kind === "threshold") {
    const kindRow = document.querySelector('[aria-label="Trigger kind"]');
    const buttons = Array.from(
      kindRow?.querySelectorAll('[role="radio"]') ?? [],
    ) as HTMLElement[];
    /* Second option is the threshold arm ("At telemetry"), matched by
       position rather than by copy so a wording change does not silently render
       the wrong state. */
    buttons[1]?.click();
    await rafTick();
    await settle(60);
  }
}

(
  window as unknown as {
    __renderAlarms: (payload: AlarmsProbePayload) => Promise<void>;
  }
).__renderAlarms = renderAlarms;
