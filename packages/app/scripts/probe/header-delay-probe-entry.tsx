import { ScreenProvider } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { harnessTheme } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { MissionBanner } from "../../src/components/MissionBanner";

/**
 * Browser entry for the header delay render harness. esbuild bundles it into
 * `header-delay-probe.html`, and `scripts/render-header-delay.ts` drives it
 * through `window.__renderHeaderDelay`.
 *
 * The provider is given no `store`, so it builds the production one and wires
 * its `DelayAuthority` to `comms.delay` exactly as the app does. A fixture
 * store would own its clock's delay and the shot would show a number nothing
 * in the app computes.
 */

setQuantityLocale("en-GB");

interface Scene {
  /** Topic payloads to publish, in order, each stamped with `vantage`. */
  emit: [topic: string, payload: unknown][];
  /** The centre the frames are stamped from. */
  vantage: string;
  /** Topics the header under test reads, so the first pass repeats until each has a subscriber. */
  awaitTopics: string[];
  pxW: number;
  pxH: number;
}

const CARRIED = [
  "commandCentre.roster",
  "comms.link",
  "comms.delay",
  "spaceCenter.scene",
];

let root: Root | undefined;
let client: TelemetryClient | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  host.style.width = `${scene.pxW}px`;
  host.style.height = `${scene.pxH}px`;

  root?.unmount();
  client?.dispose();

  const transport = new StubTransport();
  client = new TelemetryClient(transport);
  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value="main">
        <TelemetryProvider client={client} carriedChannels={CARRIED}>
          <MissionBanner />
        </TelemetryProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );

  /*
   * A `StubTransport` emit is subscription-gated, and subscriptions land in
   * effects on frames nobody can count: the header subscribes the scene some
   * time after mount, and the delay field (the only reader of `comms.link`)
   * mounts only after a scene frame has said a craft is flying. So the first
   * pass is repeated, at the same instant, until every topic the header under
   * test reads has a subscriber. Publishing on a frame count instead dropped
   * whichever frame arrived first.
   *
   * The later passes are a little over two light-times apart, the way the mod
   * publishes every tick, so the view clock's confirmed edge sits between two
   * samples and a Delayed channel reads current.
   */
  await until(
    () => {
      publish(transport, scene, 98_557);
      return scene.awaitTopics.every((topic) => transport.isSubscribed(topic));
    },
    `topics subscribed: ${scene.awaitTopics.join(", ")}`,
  );
  publish(transport, scene, 98_957);
  publish(transport, scene, 99_357);
  await twoFrames();
}

function publish(transport: StubTransport, scene: Scene, validAt: number) {
  for (const [topic, payload] of scene.emit) {
    transport.emit(topic, payload, {
      vantage: scene.vantage,
      validAt,
      deliveredAt: validAt,
    });
  }
}

/** Resolves on the first frame `condition` holds, and names what never did. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out: ${what}`);
    await twoFrames();
  }
}

(
  window as unknown as { __renderHeaderDelay: (s: Scene) => Promise<void> }
).__renderHeaderDelay = renderScene;
