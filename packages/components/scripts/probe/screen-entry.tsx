/**
 * Screen probe entry — the screen-level analog of `probe-entry.tsx`. Bundled
 * by esbuild for the playwright render harness; exposes
 * `window.__renderScreen({...})` so the driver can mount a full-screen view
 * many times with different prop sets (idle / error / reconnecting) and at
 * different viewport breakpoints without reloading or re-bundling.
 *
 * Unlike the widget probe, a screen owns the whole viewport (its own
 * `min-height: 100vh`, safe-area insets, and `@media` breakpoints), so the
 * driver resizes the PAGE viewport per breakpoint rather than sizing `#root`.
 * That is what makes the screen's `@media (max-width: 480px)` /
 * `(pointer: coarse)` rules actually engage under Playwright.
 *
 * No data sources, no PeerClientService: the connect screen is a pure
 * presentational view (`StationConnectView`) whose idle/error/reconnecting
 * states are just different prop sets. The driver passes the prop set; the
 * probe renders it.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  StationConnectView,
  type StationConnStatus,
} from "../../src/StationConnectView";

export interface ScreenProbePayload {
  screenId: string;
  /** Prop set selecting the visual state (idle / error / reconnecting). */
  props: {
    hostInput: string;
    connStatus: StationConnStatus;
    hostNotFound: boolean;
    everConnected: boolean;
  };
}

let activeRoot: Root | null = null;

/** The set of registered screens the probe can render. Keyed by screenId so
 *  the harness's `screens.ts` registry stays the single source of which
 *  screens exist; the probe only needs to know how to mount each one. */
function renderScreenView(payload: ScreenProbePayload) {
  switch (payload.screenId) {
    case "station-connect":
      return createElement(StationConnectView, {
        ...payload.props,
        onHostInputChange: () => {},
        onConnect: () => {},
        onDownloadLogs: () => {},
        // A static placeholder for the app-scoped station-name editor slot.
        // The real editor needs React context only the app provides; the
        // harness verifies the surrounding layout, so a representative chip
        // stands in.
        nameEditor: createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "var(--color-text-muted)",
            },
          },
          "Station name: ",
          createElement(
            "span",
            { style: { color: "var(--color-text-primary)" } },
            "LFV-1b",
          ),
        ),
      });
    default:
      throw new Error(`Screen probe: unknown screenId "${payload.screenId}"`);
  }
}

async function renderScreen(payload: ScreenProbePayload): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Screen probe: #root element missing");

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }

  activeRoot = createRoot(root);
  activeRoot.render(renderScreenView(payload));

  // Two frames: commit + let styled-components inject + ResizeObserver settle.
  await rafTick();
  await rafTick();
  await settle(120);
}

function rafTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function settle(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

declare global {
  interface Window {
    __renderScreen: (payload: ScreenProbePayload) => Promise<void>;
  }
}

window.__renderScreen = renderScreen;
