import "../../src/uplinks/install-host-first";
import { ScreenProvider } from "@ksp-gonogo/core";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { harnessTheme, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { MissionBanner } from "../../src/components/MissionBanner";
import { LayoutHistoryControl } from "../../src/missionProfiles/LayoutHistoryControl";
import { MissionProfilesProvider } from "../../src/missionProfiles/MissionProfilesContext";
import { MissionProfilesService } from "../../src/missionProfiles/MissionProfilesService";
import { ProfileDashboard } from "../../src/missionProfiles/ProfileDashboard";

/**
 * Browser entry for the layouts header render harness. esbuild bundles it into
 * `layouts-header-probe.html`, and `scripts/render-layouts-header.ts` drives it
 * through `window.__renderLayoutsHeader`.
 */

setQuantityLocale("en-GB");

interface Scene {
  layoutName: string;
  /** Widget changes made before the shot: a flushed edit is an Undo step, a stepped-back one a Redo step. */
  edits: number;
  undone: boolean;
  pxW: number;
  pxH: number;
}

let root: Root | undefined;
let client: TelemetryClient | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  host.style.width = `${scene.pxW}px`;
  host.style.height = `${scene.pxH}px`;

  root?.unmount();
  client?.dispose();
  const transport = new StubTransport();
  client = new TelemetryClient(transport);

  const svc = new MissionProfilesService("main", memoryStorage());
  svc.setCurrent(svc.save(scene.layoutName, [], []).id);
  const dashboard = new ProfileDashboard(svc, () => {}, {
    items: [],
    layout: [],
  });
  dashboard.attach();
  for (let n = 1; n <= scene.edits; n++) {
    const id = `w${n}`;
    dashboard.recordChange(
      [{ i: id, componentId: "fuel-status" }],
      [{ i: id, x: 0, y: 0, w: 4, h: 4, moved: false, static: false }],
    );
    dashboard.flush();
  }
  if (scene.undone) dashboard.undo();

  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value="main">
        <TelemetryProvider client={client}>
          <MissionProfilesProvider service={svc}>
            <MissionBanner
              actions={<LayoutHistoryControl dashboard={dashboard} />}
            />
          </MissionProfilesProvider>
        </TelemetryProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );
  /*
   * A vessel in flight with a delay, so the strip carries the fields the real
   * header does. Emits are subscription-gated, so publish until each topic
   * has a subscriber.
   */
  const topics: [string, unknown][] = [
    ["spaceCenter.scene", { scene: "Flight" }],
    ["vessel.identity", { vesselId: "v1", name: "Kerbal X" }],
    ["comms.delay", { oneWaySeconds: 3.2, source: 1 }],
    ["comms.link", { connected: true }],
  ];
  for (let pass = 0; pass < 120; pass++) {
    const at = 98_557 + pass * 400;
    for (const [topic, payload] of topics) {
      transport.emit(topic, payload, {
        vantage: "ground:Kerbal Space Center",
        validAt: at,
        deliveredAt: at,
      });
    }
    await twoFrames();
    const text = host.textContent ?? "";
    if (text.includes("Delay") && text.includes("Kerbal X")) break;
  }
  await twoFrames();
}

(
  window as unknown as { __renderLayoutsHeader: (s: Scene) => Promise<void> }
).__renderLayoutsHeader = renderScene;
