import { getComponent } from "@ksp-gonogo/sitrep-sdk";
import {
  clearPlanDrafts,
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

/**
 * The plan composer, driven for real.
 *
 * <p>Nothing about it is pre-populated: the driver presses the widget's own
 * buttons, so what a render shows is what an operator gets by pressing them. A
 * scene that injected drafts into the store would render a composer that had
 * never composed anything, which is exactly the state a render cannot be allowed
 * to be silent about.</p>
 */
interface ComposerScene {
  kind: "composer";
  hostTitle: string;
  /** One-way light time to the craft, seconds. Zero for a vantage with no delay. */
  oneWaySeconds?: number;
  pxW: number;
  pxH: number;
}

type Scene = WidgetScene | SectionScene | BadgeScene | ComposerScene;

let root: Root | null = null;

function teardown(): void {
  if (root) {
    root.unmount();
    root = null;
  }
  // The draft store is module scope, so it OUTLIVES a scene. Without this every
  // composer scene inherits the drafts the one before it made, and the render
  // shows a plan list nobody in that scene composed: the armed-upload scene came
  // out with two plans in it and a leftover empty draft, all of which looked
  // exactly like the widget's real output. After the unmount, never before,
  // because clearing it under a mounted tree notifies subscribers of a tree that
  // is still rendering.
  clearPlanDrafts();
}

/** Pinned so an "observed now" badge really is now, and an aged one is aged by
 *  the amount the fixture says. The driver's scenes state their own instants
 *  relative to this. */
const VIEW_UT = 1_000_000;

/**
 * Waits for the widget's own subscribe to reach the transport.
 *
 * <p><b>An emit to an unsubscribed topic is DROPPED, silently.</b>
 * `StubTransport.emit` returns early when nothing is listening, which is right:
 * it mirrors a real stream, and the emit landing at all is part of what this
 * harness proves. What it also does is turn a slow mount into a render of the
 * widget's never-observed state, and that render is indistinguishable from a
 * real one. Two scenes shipped that way in a single run on a loaded machine and
 * came out identical to the "no plan has been observed" scene, which is exactly
 * the wrong thing to hand a reviewer.</p>
 *
 * <p>A count of animation frames cannot fix this, because how many are enough
 * depends on the machine. The subscription is the actual precondition, so it is
 * the thing waited on, and giving up after the deadline THROWS rather than
 * carrying on to photograph whatever is on screen.</p>
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
      "frames, so an emit would have been dropped and the scene rendered as " +
      "never observed.",
  );
}

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
  const { FlightPlanSection, PlanComposer } = await registered;
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
    "principia.settings",
    "vessel.identity",
    // The composer's own three. Carried for every scene rather than per kind:
    // the fixture only DELIVERS what a scene emits, so an unused channel costs
    // nothing, and a channel missing from this list is a widget that renders
    // empty for a reason no render can show.
    "vessel.orbit",
    "vessel.maneuver.plan.send",
    "comms.delay",
  ];
  const stream = setupStreamFixture({
    carriedChannels: carried,
    pinnedUt: VIEW_UT,
  });

  if (scene.kind === "composer") {
    mount(
      el,
      createElement(
        stream.Provider,
        null,
        createElement(
          Panel,
          { panelTitle: scene.hostTitle },
          createElement(PanelBody, null, createElement(PlanComposer, null)),
        ),
      ),
    );
    await awaitSubscribed(stream.transport, "vessel.orbit");
    stream.emit(
      "vessel.identity",
      { vesselId: "Ares-IV", name: "Ares IV", vesselType: 0, situation: 0 },
      { validAt: VIEW_UT },
    );
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 850_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: 3.5316e12,
      },
      { validAt: VIEW_UT },
    );
    if (scene.oneWaySeconds) {
      stream.emit(
        "comms.delay",
        { oneWaySeconds: scene.oneWaySeconds },
        { validAt: VIEW_UT },
      );
    }
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    return;
  }

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

  // Emitted once the widget's own subscribe has REACHED the transport, not
  // merely after a frame: a `StubTransport` delivers nothing to an unsubscribed
  // topic, which makes the emit landing part of what this harness proves and
  // makes a lost one a render of the wrong state. See `awaitSubscribed`.
  await awaitSubscribed(stream.transport, scene.topic);
  if (scene.kind === "section" && scene.identity) {
    // Waited on separately. The widget subscribes to both in one render today,
    // so one wait would do; a scene whose identity went missing because the
    // other subscribe happened to land first would look like a plan belonging
    // to nobody, which is a state this harness has a scene for.
    await awaitSubscribed(stream.transport, "vessel.identity");
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
