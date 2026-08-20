import { getComponent } from "@ksp-gonogo/sitrep-sdk";
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
  PanelStatusStoreProvider,
  registerAugment,
  type Severity,
  setQuantityLocale,
  useStatusContribution,
} from "@ksp-gonogo/ui-kit";
import { WidgetHost } from "@ksp-gonogo/ui-kit/testing";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";

/**
 * Browser entry for this Uplink's render harness. esbuild bundles it into
 * probe.html and `scripts/render-principia.ts` (Playwright) drives it through
 * `window.__renderPrincipia`, screenshotting `#root`.
 *
 * Everything mounted here is the REAL thing, driven off a REAL stream: the
 * fixture is a `TelemetryProvider` over a `StubTransport`, the same one the
 * vitest suite uses, so a widget that would render empty in the app renders
 * empty here. Nothing is stubbed at the component boundary.
 *
 * Imports only the published packages (`@ksp-gonogo/sitrep-sdk`,
 * `@ksp-gonogo/ui-kit`, react) plus this Uplink's own source, which is the
 * whole point: a probe reaching into `@ksp-gonogo/core` is what broke Uplink
 * isolation before, and a harness a third-party author cannot run is not a
 * harness. See the driver's own comment for the one thing this cannot do.
 */

// The sdk's stateful surface is runtime-injected by the app, so a bundled probe
// has to install a host before anything registers against it. That is also why
// this Uplink's own source is imported DYNAMICALLY below rather than at the top:
// a static side-effect import is hoisted above every statement here, so the
// widget's `registerComponent` would run against an uninstalled host and throw.
// Ordering by import position would work today and break the moment an
// import-sorter moved a line.
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

/** Loaded once, after the host is in place. Also yields the section component,
 *  which has no registry entry to look up because it is an augment. */
const registered = import("../../src");

/** A widget registered in this Uplink, rendered inside the dashboard's own
 *  provider stack. */
interface WidgetScene {
  kind: "widget";
  widgetId: string;
  topic: string;
  payload: Record<string, unknown>;
  config?: Record<string, unknown>;
  pxW: number;
  pxH: number;
}

/**
 * An augment section, rendered inside a stand-in `Panel`.
 *
 * The host widget it really binds to lives in a package an Uplink may not
 * import, so this is the closest a harness inside the Uplink can get, and it is
 * honest about being that: the chrome is a ui-kit `Panel` with the host's title,
 * and the section inside it is the real one. What it cannot show is how the
 * section sits against the host's own rows above it.
 */
interface SectionScene {
  kind: "section";
  hostTitle: string;
  topic: string;
  payload: Record<string, unknown>;
  identity?: Record<string, unknown>;
  /** The sample's own instant, defaulting to the pinned view time. A scene that
   *  wants a stale reading has to state it: the transport defaults `validAt` to
   *  zero, so leaving it out is not "now". */
  validAt?: number;
  pxW: number;
  pxH: number;
}

/**
 * A panel carrying one status contribution, which is how the trajectory-currency
 * badge reaches an operator.
 *
 * The bridge that decides the severity and label is app-side, so what is
 * rendered here is the OUTCOME it publishes rather than the bridge itself: the
 * real `Panel`, the real `PanelStatusStore`, the real `Badge`, driven by the same
 * contribution shape the bridge registers. The quiet state renders nothing and
 * proves nothing, so only the loud states are worth a scene.
 */
interface BadgeScene {
  kind: "badge";
  hostTitle: string;
  severity: Severity;
  label: string;
  pxW: number;
  pxH: number;
}

type Scene = WidgetScene | SectionScene | BadgeScene;

let root: Root | null = null;

function teardown(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}

/** Pinned so an "observed now" badge really is now, and an aged one is aged by
 *  the amount the fixture says. The driver's scenes state their own instants
 *  relative to this. */
const VIEW_UT = 1_000_000;

function ProbeStatusContribution({
  severity,
  label,
}: {
  severity: Severity;
  label: string;
}) {
  useStatusContribution({ id: "trajectory-currency", severity, label });
  return null;
}

/**
 * Mounts under the harness theme.
 *
 * ui-kit's styled components read the theme object directly (radii, spacing),
 * not only the CSS custom properties, so without a `ThemeProvider` they throw
 * inside style generation rather than merely rendering unstyled. The token block
 * injected into the page covers the custom properties; this covers the other
 * half. `harnessTheme` is the same one the vitest suite renders with, generated
 * from the real dark theme, so a render here matches a render there.
 */
function mount(el: HTMLElement, children: ReactNode): void {
  root = createRoot(el);
  root.render(createElement(ThemeProvider, { theme: harnessTheme }, children));
}

async function renderPrincipia(scene: Scene): Promise<void> {
  const { FlightPlanSection } = await registered;
  teardown();

  const el = document.getElementById("root");
  if (!el) throw new Error("no #root");
  el.style.width = `${scene.pxW}px`;
  el.style.height = `${scene.pxH}px`;

  if (scene.kind === "badge") {
    mount(
      el,
      createElement(
        PanelStatusStoreProvider,
        null,
        createElement(
          Panel,
          { panelTitle: scene.hostTitle },
          createElement(ProbeStatusContribution, {
            severity: scene.severity,
            label: scene.label,
          }),
        ),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    return;
  }

  const carried = [
    "principia.flightPlan",
    "principia.provenance",
    "vessel.identity",
  ];
  const stream = setupStreamFixture({
    carriedChannels: carried,
    pinnedUt: VIEW_UT,
  });

  if (scene.kind === "widget") {
    const def = getComponent(scene.widgetId);
    if (!def)
      throw new Error(`Probe: widget "${scene.widgetId}" not registered`);
    mount(
      el,
      createElement(
        stream.Provider,
        null,
        createElement(
          WidgetHost,
          { widgetId: scene.widgetId, instanceId: "probe" },
          createElement(def.component, {
            config: scene.config ?? {},
            id: "probe",
          }),
        ),
      ),
    );
  } else {
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
          // without it has its right-pinned values clipped at the panel edge. The
          // first renders showed exactly that, and it was the harness missing the
          // host's own wrapper rather than the section being wrong.
          createElement(
            PanelBody,
            null,
            createElement(FlightPlanSection, null),
          ),
        ),
      ),
    );
  }

  // Emitted AFTER mount, so the widget's own subscribe has run: a
  // `StubTransport` delivers nothing to an unsubscribed topic, which makes the
  // emit landing part of what this harness proves.
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  if (scene.kind === "section" && scene.identity) {
    stream.emit("vessel.identity", scene.identity, { validAt: VIEW_UT });
  }
  const validAt =
    scene.kind === "section" && scene.validAt !== undefined
      ? scene.validAt
      : VIEW_UT;
  stream.emit(scene.topic, scene.payload, { validAt });
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

(
  window as unknown as { __renderPrincipia: typeof renderPrincipia }
).__renderPrincipia = renderPrincipia;
