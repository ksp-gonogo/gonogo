import {
  harnessTheme,
  installRealTestHost,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot,
  clearAugments,
  getAugmentsForSlot,
  Panel,
  PanelBody,
  registerAugment,
  setKspCalendar,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { RSS_CALENDAR } from "./rssCalendar";

/**
 * Browser entry for this Uplink's render harness. esbuild bundles it into
 * probe.html and `scripts/render-rp1.ts` (Playwright) drives it through
 * `window.__renderRp1`, screenshotting `#root`.
 *
 * Everything mounted here is the REAL thing, driven off a REAL stream: the
 * fixture is a `TelemetryProvider` over a `StubTransport`, the same one the
 * vitest suite uses, so a surface that would render empty in the app renders
 * empty here. Nothing is stubbed at the component boundary.
 *
 * Imports only the published packages (`@ksp-gonogo/sitrep-sdk`,
 * `@ksp-gonogo/ui-kit`, react) plus this Uplink's own source, which is the whole
 * point: a harness a third-party author cannot run is not a harness.
 *
 * The one thing it cannot do: render a section inside its REAL host widget.
 * `SpaceCenterStatus` lives in a package an Uplink may not import, so the
 * section is rendered inside a stand-in ui-kit `Panel` carrying the host's
 * title. The layout of the section is faithful; how it sits under the host's own
 * facility grid is not shown, and rendering that needs a harness on the app side.
 */

// The sdk's stateful surface is runtime-injected by the app, so a bundled probe
// has to install a host before anything registers against it. That is also why
// this Uplink's own source is imported DYNAMICALLY below: a static side-effect
// import is hoisted above every statement here, so the registrations would run
// against an uninstalled host and throw.
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

// The calendar an RP-1 career is flown on, and why the harness has to set it
// itself: see `rssCalendar.ts`.
setKspCalendar({ ...RSS_CALENDAR });

/** Loaded once, after the host is in place. */
const registered = import("../../src");

/** The sections this harness can mount, by the export name they ship under. */
type SurfaceName = "KscConstruction";

/**
 * One section, and the stream it is driven by.
 *
 * <p>`emits` is ordered, and every topic in it is waited on before its payload
 * is sent: a `StubTransport` silently drops an emit to a topic nothing is
 * listening to, which turns a slow mount into a render of the never-observed
 * state that looks exactly like a real one.</p>
 */
interface Scene {
  surface: SurfaceName;
  hostTitle: string;
  emits: Array<[string, unknown]>;
  pxW: number;
  pxH: number;
}

let root: Root | null = null;

function teardown(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}

/** Pinned so a render is the same image on every machine. */
const VIEW_UT = 1_000_000;

/**
 * Waits for a surface's own subscribe to reach the transport.
 *
 * <p>Giving up THROWS rather than carrying on to photograph whatever is on
 * screen: a dropped emit renders the empty state, and an empty render handed to
 * a reviewer is indistinguishable from a surface that is working and has nothing
 * to say.</p>
 */
const SUBSCRIBE_FRAMES = 300;

async function awaitSubscribed(
  transport: { isSubscribed: (topic: string) => boolean },
  topic: string,
): Promise<void> {
  for (let frame = 0; frame < SUBSCRIBE_FRAMES; frame++) {
    if (transport.isSubscribed(topic)) return;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }
  throw new Error(
    `Probe: nothing subscribed to "${topic}" after ${SUBSCRIBE_FRAMES} ` +
      "frames, so the emit would have been dropped and the scene rendered as " +
      "never observed.",
  );
}

/**
 * Mounts under the harness theme.
 *
 * ui-kit's styled components read the theme object directly (radii, spacing),
 * not only the CSS custom properties, so without a `ThemeProvider` they throw
 * inside style generation rather than merely rendering unstyled. The token block
 * injected into the page covers the custom properties; this covers the other
 * half.
 */
function mount(el: HTMLElement, children: ReactNode): void {
  root = createRoot(el);
  root.render(createElement(ThemeProvider, { theme: harnessTheme }, children));
}

async function renderRp1(scene: Scene): Promise<void> {
  const surfaces = await registered;
  teardown();

  const el = document.getElementById("root");
  if (!el) throw new Error("no #root");
  el.style.width = `${scene.pxW}px`;
  el.style.height = `${scene.pxH}px`;

  const Surface = surfaces[scene.surface];
  if (!Surface) throw new Error(`Probe: no surface called "${scene.surface}"`);

  const stream = setupStreamFixture({
    carriedChannels: scene.emits.map(([topic]) => topic),
    pinnedUt: VIEW_UT,
  });

  mount(
    el,
    createElement(
      stream.Provider,
      null,
      createElement(
        Panel,
        { panelTitle: scene.hostTitle },
        // `PanelBody` because the real host puts its sections inside one: it
        // supplies the content inset and the scrolling, and a section rendered
        // without it has its right-pinned values clipped at the panel edge.
        createElement(PanelBody, null, createElement(Surface, null)),
      ),
    ),
  );

  for (const [topic, payload] of scene.emits) {
    await awaitSubscribed(stream.transport, topic);
    stream.emit(topic, payload, { validAt: VIEW_UT });
  }
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

(window as unknown as { __renderRp1: typeof renderRp1 }).__renderRp1 =
  renderRp1;
