import { ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import {
  harnessTheme,
  installRealTestHost,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { SettingsProvider } from "../../src/settings/SettingsContext";
import { SettingsModal } from "../../src/settings/SettingsModal";
import { SettingsService } from "../../src/settings/SettingsService";

/**
 * Browser entry for the settings-surface render harness. esbuild bundles it
 * into `settings-probe.html`, and `scripts/render-settings.ts` drives it
 * through `window.__renderSettings`, screenshotting `#root`.
 *
 * The modal is the REAL one, reading the REAL registry over a REAL
 * `TelemetryProvider`. Nothing is stubbed at the component boundary, so a row
 * that would render its null placeholder in the app renders it here: the whole
 * point of a render is to see the state a reviewer would actually meet.
 *
 * This lives app-side rather than in the Uplink because `SettingsModal` is in a
 * package an Uplink may not import. That is also the gap it closes: an Uplink's
 * own harness can render its widgets but never its settings rows, because the
 * surface those rows land on is not one it may reach.
 */

installRealTestHost({
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
});

// Pin the locale every quantity is written in. It defaults to the reader's,
// which is right for an operator and wrong for a render that has to look the
// same on every machine.
setQuantityLocale("en-GB");

/**
 * The rows, registered after the host is in place.
 *
 * Dynamic, and for the reason the Uplink's own probe records: a static
 * side-effect import is hoisted above every statement in this file, so
 * `registerSetting` would run against an uninstalled host and throw.
 */
const registered = Promise.all([
  // The app's own rows, for the `dependsOn` pair: mission history's two
  // children go inert when the parent is off, which no Uplink row can show
  // because no Uplink row is writable.
  import("../../src/settings/missionHistorySettings"),
  // The Uplink, by package name: the app already depends on it, and importing
  // the whole client rather than its settings module is what the app does.
  import("@ksp-gonogo/gonogo-principia-uplink"),
]);

/** What one shot asks for. */
interface Scene {
  /** Topics the fixture carries, and the payload to publish on each. */
  emit?: Record<string, unknown>;
  /** Settings written into the service before mount, by id. */
  prefs?: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

let root: Root | undefined;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  } as Storage;
}

/**
 * An inert query client. The modal fires a Hub-registry query for its
 * attention dot, and a render is not the place for a network round-trip that
 * would resolve halfway through a screenshot.
 */
function inertQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
}

async function renderScene(scene: Scene): Promise<void> {
  await registered;

  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  host.style.width = `${scene.pxW}px`;
  host.style.height = `${scene.pxH}px`;
  host.style.overflow = "hidden";

  if (root) {
    root.unmount();
    root = undefined;
  }

  const topics = Object.keys(scene.emit ?? {});
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: topics,
    pinnedUt: 1_000_000,
  });

  const service = new SettingsService(memoryStorage());
  for (const [id, v] of Object.entries(scene.prefs ?? {})) {
    service.set(id, v);
  }

  root = createRoot(host);
  root.render(
    <QueryClientProvider client={inertQueryClient()}>
      <ThemeProvider theme={harnessTheme}>
        <ScreenProvider value="main">
          <SettingsProvider service={service}>
            <SerialDeviceProvider
              service={new SerialDeviceService({ screenKey: "render-probe" })}
            >
              <fixture.Provider>
                <SettingsModal initialTabId="general" />
              </fixture.Provider>
            </SerialDeviceProvider>
          </SettingsProvider>
        </ScreenProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  // A `StubTransport` emit is subscription-gated, so the rows have to be
  // mounted and subscribed before anything is published. Two frames is what it
  // takes for React to commit and for the rows' effects to run.
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
  for (const [topic, payload] of Object.entries(scene.emit ?? {})) {
    fixture.emit(topic, payload as never);
  }
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
}

(
  window as unknown as { __renderSettings: (s: Scene) => Promise<void> }
).__renderSettings = renderScene;
