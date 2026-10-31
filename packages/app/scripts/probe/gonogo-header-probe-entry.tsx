import "../../src/uplinks/install-host-first";
import { ScreenProvider } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { harnessTheme, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { MissionBanner } from "../../src/components/MissionBanner";
import {
  GoNoGoHostProvider,
  GoNoGoHostService,
  MainPollHeader,
  PollSettingsControl,
  StationPollControl,
} from "../../src/goNoGo";
import type { Vote } from "../../src/goNoGo/GoNoGoHostService";
import { LayoutHistoryControl } from "../../src/missionProfiles/LayoutHistoryControl";
import { MissionProfilesProvider } from "../../src/missionProfiles/MissionProfilesContext";
import { MissionProfilesService } from "../../src/missionProfiles/MissionProfilesService";
import { ProfileDashboard } from "../../src/missionProfiles/ProfileDashboard";
import {
  type PeerClient,
  PeerClientProvider,
} from "../../src/peer/PeerClientContext";
import type { StationApproval } from "../../src/peer/PeerClientService";
import { HelpButton } from "../../src/settings/HelpButton";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../../src/stationIdentity";
import { asHostService, idlePeerClient } from "../../src/test/peerFakes";

/**
 * Browser entry for the GO/NO-GO header render harness. esbuild bundles it into
 * `gonogo-header-probe.html`, and `scripts/render-gonogo-header.ts` drives it
 * through `window.__renderGonogoHeader`.
 */

setQuantityLocale("en-GB");

interface Scene {
  screen: "main" | "station";
  /** Main: the connected stations and their votes. */
  stations?: [string, Vote][];
  /** Station: whether the main screen has let it into the poll. */
  approval?: StationApproval;
  /** Station: a countdown running when the shot is taken. */
  countdownSeconds?: number;
  /** Station: the craft is past liftoff. */
  launched?: boolean;
  /** Station: the main screen reset the poll after liftoff. */
  reopened?: boolean;
  /** The game is at the space centre rather than in flight. */
  spaceCentre?: boolean;
  pxW: number;
}

let root: Root | undefined;
let client: TelemetryClient | undefined;
let host: GoNoGoHostService | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

type Listener = (...args: unknown[]) => void;

class ProbePeers {
  private listeners = new Map<string, Set<Listener>>();
  private on(event: string, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return () => set.delete(cb);
  }
  fire(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }
  onPeerConnect = (cb: Listener) => this.on("connect", cb);
  onPeerDisconnect = (cb: Listener) => this.on("disconnect", cb);
  onStationInfo = (cb: Listener) => this.on("info", cb);
  onGonogoVote = (cb: Listener) => this.on("vote", cb);
  onGonogoAbort = (cb: Listener) => this.on("abort", cb);
  broadcast = () => {};
  sendToPeer = () => {};
}

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

function stationClient(scene: Scene): PeerClient {
  return {
    ...idlePeerClient(),
    getApproval: () => scene.approval ?? "approved",
    onGonogoOnGo: (cb) => {
      cb("Stage");
      return () => {};
    },
    onGonogoCountdownStart: (cb) => {
      if (scene.countdownSeconds !== undefined) {
        cb(Date.now() + scene.countdownSeconds * 1000);
      }
      return () => {};
    },
    onGonogoReset: (cb) => {
      if (scene.reopened) setTimeout(() => cb(true), 50);
      return () => {};
    },
  };
}

async function renderScene(scene: Scene): Promise<void> {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root missing");
  el.style.width = `${scene.pxW}px`;

  root?.unmount();
  client?.dispose();
  host?.dispose();
  const transport = new StubTransport();
  client = new TelemetryClient(transport);

  const profiles = new MissionProfilesService(scene.screen, memoryStorage());
  profiles.setCurrent(profiles.save("Ascent", [], []).id);
  const dashboard = new ProfileDashboard(profiles, () => {}, {
    items: [],
    layout: [],
  });
  dashboard.attach();

  const peers = new ProbePeers();
  host = new GoNoGoHostService(asHostService(peers));
  for (const [i, [name, vote]] of (scene.stations ?? []).entries()) {
    peers.fire("connect", `p${i}`);
    peers.fire("info", `p${i}`, { name });
    peers.fire("vote", `p${i}`, vote);
  }

  const identity = new StationIdentityService();
  identity.setName("Flight Director");

  const actions = (
    <>
      <LayoutHistoryControl dashboard={dashboard} />
      <HelpButton />
    </>
  );
  const centre =
    scene.screen === "main" ? <MainPollHeader /> : <StationPollControl />;

  root = createRoot(el);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value={scene.screen}>
        <ModalProvider>
          <TelemetryProvider client={client}>
            <MissionProfilesProvider service={profiles}>
              <SerialDeviceProvider
                service={new SerialDeviceService({ screenKey: scene.screen })}
              >
                <StationIdentityProvider service={identity}>
                  <PeerClientProvider client={stationClient(scene)}>
                    <GoNoGoHostProvider service={host}>
                      <MissionBanner
                        centre={centre}
                        centreControls={
                          scene.screen === "main" ? (
                            <PollSettingsControl />
                          ) : undefined
                        }
                        actions={actions}
                      />
                    </GoNoGoHostProvider>
                  </PeerClientProvider>
                </StationIdentityProvider>
              </SerialDeviceProvider>
            </MissionProfilesProvider>
          </TelemetryProvider>
        </ModalProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );

  const topics: [string, unknown][] = [
    [
      "spaceCenter.scene",
      { scene: scene.spaceCentre ? "SpaceCenter" : "Flight" },
    ],
    [
      "vessel.identity",
      {
        vesselId: "v1",
        name: "Kerbal X",
        launchUt: scene.launched ? 98_000 : null,
      },
    ],
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
    const text = el.textContent ?? "";
    const centreDrawn =
      scene.spaceCentre ||
      (scene.screen === "main"
        ? (scene.stations ?? []).every(([n]) => text.includes(n)) ||
          text.includes("T −")
        : text.includes("Flight Director") &&
          (!scene.launched || text.includes("ABORT")));
    if (text.includes("Kerbal X") && centreDrawn) break;
  }
  await new Promise((r) => setTimeout(r, 120));
  await twoFrames();
}

(
  window as unknown as { __renderGonogoHeader: (s: Scene) => Promise<void> }
).__renderGonogoHeader = renderScene;
