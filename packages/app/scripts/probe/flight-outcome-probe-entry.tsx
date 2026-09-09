import { ScreenProvider } from "@ksp-gonogo/core";
import {
  harnessTheme,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { FlightOutcomeBanner } from "../../src/components/FlightOutcomeBanner";

/**
 * Browser entry for the flight-outcome render harness. esbuild bundles it into
 * `flight-outcome-probe.html`, and `scripts/render-flight-outcome.ts` drives it
 * through `window.__renderFlightOutcome`.
 *
 * The banner is the REAL one over a REAL stream fixture, publishing the wire
 * shape the mod publishes: bare numbers, which the SDK wraps into `Value`s on
 * decode exactly as it does in the app. That is the whole subject of these
 * shots, so nothing may be pre-wrapped on the way in.
 */

// Pin the locale every quantity is written in. It defaults to the reader's,
// which is right for an operator and wrong for a render that has to look the
// same on every machine.
setQuantityLocale("en-GB");

/** What one shot asks for. */
interface Scene {
  /** Topics the fixture carries, and the payload to publish on each. */
  emit: Record<string, unknown>;
  /** Click the banner first, so the shot is of the detail modal. */
  openDetail?: boolean;
  pxW: number;
  pxH: number;
}

let root: Root | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  host.style.width = `${scene.pxW}px`;
  host.style.height = `${scene.pxH}px`;

  if (root) {
    root.unmount();
    root = undefined;
  }

  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: Object.keys(scene.emit),
    pinnedUt: 1_000_000,
  });

  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value="main">
        <ModalProvider>
          <fixture.Provider>
            <FlightOutcomeBanner />
          </fixture.Provider>
        </ModalProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );

  // A `StubTransport` emit is subscription-gated, so the banner has to be
  // mounted and subscribed before anything is published.
  await twoFrames();
  for (const [topic, payload] of Object.entries(scene.emit)) {
    fixture.emit(topic, payload as never);
  }
  await twoFrames();

  if (scene.openDetail) {
    const banner = host.querySelector<HTMLButtonElement>(
      'button[role="status"]',
    );
    if (!banner) throw new Error("no banner to open");
    banner.click();
    await twoFrames();
  }
}

(
  window as unknown as { __renderFlightOutcome: (s: Scene) => Promise<void> }
).__renderFlightOutcome = renderScene;
