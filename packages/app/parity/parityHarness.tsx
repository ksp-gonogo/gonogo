import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ComponentDefinition,
  DashboardItemContext,
  getComponent,
  PerfBudget,
  registerStockBodies,
  ScreenProvider,
} from "@ksp-gonogo/core";
import {
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
  PRODUCTION_DERIVED_CHANNELS,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  type Transport,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  type FakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { WidgetBody } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { listWidgets } from "../../components/scripts/widgets";
import {
  AlarmsLauncherProvider,
  type PendingAlarmSummary,
} from "../../components/src/shared/AlarmsLauncher";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  stripVolatile,
  WidgetContributions,
} from "../../components/src/test/widgetDomSnapshot";
import { PeerClientService } from "../src/peer/PeerClientService";
import { PeerHostService } from "../src/peer/PeerHostService";
import { PeerTransport } from "../src/telemetry/PeerTransport";
import { SitrepPeerRelay } from "../src/telemetry/SitrepPeerRelay";

interface StreamEmit {
  channel: string;
  value: unknown;
  meta?: Partial<Meta>;
}

/** One widget in one fixture's scene, at the largest size its render config draws. */
export interface ParityScene {
  /** `<render config label>/<fixture name>`, the key the exception and debt lists use. */
  id: string;
  widgetId: string;
  pinnedUt: number | undefined;
  emits: StreamEmit[];
  alarms: PendingAlarmSummary[] | undefined;
  size: { w: number; h: number };
  config: Record<string, unknown> | undefined;
}

const COMPONENTS_SRC = resolve(import.meta.dirname, "../../components/src");

/** Grid units to pixels, the dashboard's arithmetic. */
function gridPixels(size: { w: number; h: number }) {
  return {
    w: size.w * 32 + (size.w - 1) * 8,
    h: size.h * 25 + (size.h - 1) * 8,
  };
}

/**
 * Every widget fixture that drives its widget from the stream, as one scene
 * each. A fixture with no `_stream` block feeds a legacy data source the relay
 * does not carry, so it has no station twin to compare against.
 *
 * The largest mode is chosen because it draws the most fields, and a field is
 * what goes missing on a station.
 */
export function discoverScenes(): ParityScene[] {
  const scenes: ParityScene[] = [];
  const seen = new Set<string>();
  for (const config of listWidgets()) {
    const mode = [...config.modes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!mode) continue;
    const dir = join(COMPONENTS_SRC, config.fixturesPath);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        _stream?: { pinnedUt?: number; emits?: StreamEmit[] };
        _alarms?: PendingAlarmSummary[];
        "t.universalTime"?: number;
      };
      const stream = fixture._stream;
      if (!stream || !Array.isArray(stream.emits)) continue;
      const id = `${config.label ?? config.widgetId}/${file.replace(/\.json$/, "")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      scenes.push({
        id,
        widgetId: config.widgetId,
        pinnedUt: stream.pinnedUt ?? fixture["t.universalTime"],
        emits: stream.emits,
        alarms: fixture._alarms,
        size: { w: mode.w, h: mode.h },
        config: mode.config,
      });
    }
  }
  return scenes;
}

interface Screen {
  client: TelemetryClient;
  store: TimelineStore;
  frame: () => void;
}

/**
 * The pipeline `SitrepTelemetryProvider` mounts on either screen, over the
 * transport that screen has: the main screen's comes from the mod, a station's
 * from the host. Everything else is identical by construction, so a difference
 * between the two renders is a difference in what arrived.
 */
function buildScreen(
  transport: Transport,
  wall: FakeWallClock,
  pinnedUt: number | undefined,
): Screen {
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES,
  });
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  if (pinnedUt !== undefined) {
    clock.scrubTo(pinnedUt);
    store.beginFrame();
  }
  clock.suspendFrames();
  return {
    client,
    store,
    frame: () => {
      clock.emitFrame();
      store.beginFrame();
    },
  };
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => done());
  });
}

function WidgetMount({
  def,
  scene,
}: {
  def: ComponentDefinition;
  scene: ParityScene;
}) {
  const config = {
    ...((def.defaultConfig as Record<string, unknown> | undefined) ?? {}),
    ...(scene.config ?? {}),
  };
  return (
    <DashboardItemContext.Provider value={{ instanceId: "parity" }}>
      <WidgetContributions Widget={def.component}>
        <AlarmsLauncherProvider
          launcher={() => {}}
          creator={() => {}}
          manager={{ find: () => null, remove: () => {} }}
          pending={scene.alarms}
        >
          <WidgetBody
            def={def}
            id="parity"
            config={config}
            w={scene.size.w}
            h={scene.size.h}
          />
        </AlarmsLauncherProvider>
      </WidgetContributions>
    </DashboardItemContext.Provider>
  );
}

function ScreenTree({
  screen,
  seat,
  children,
}: {
  screen: Screen;
  seat: "main" | "station";
  children: ReactNode;
}) {
  return (
    <ScreenProvider value={seat}>
      <TelemetryProvider client={screen.client} store={screen.store}>
        {children}
      </TelemetryProvider>
    </ScreenProvider>
  );
}

/** What each screen drew, normalised so only content can differ. */
export interface SceneRenders {
  main: string;
  station: string;
  mainText: string;
  stationText: string;
}

/**
 * Every element id rewritten to its order of first appearance, with each
 * reference to it. Two screens mount two React roots whose `useId` counters
 * differ, and a widget may reshape the id it gets (stripping its colons, say)
 * past what `stripVolatile` recognises, so the ids themselves are renamed.
 */
function normaliseIds(html: string): string {
  const ids = [
    ...new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
  ];
  return ids
    .sort((a, b) => b.length - a.length)
    .reduce(
      (out, id) => out.split(id).join(`parity-id-${ids.indexOf(id)}`),
      html,
    );
}

function markupOf(container: HTMLElement): string {
  return normaliseIds(stripVolatile(container.innerHTML));
}

function textOf(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Frames a topic is given to be subscribed before its emit is dropped, as the DOM snapshot harness does. */
const SUBSCRIBE_FRAMES = 30;
/** Frames a station is given to draw what the main screen drew. */
const CONVERGE_FRAMES = 60;
/** Consecutive identical station renders that count as settled short of a match. */
const SETTLED_FRAMES = 12;

async function waitForHostPeerId(host: PeerHostService): Promise<void> {
  if (host.peerId) return;
  await new Promise<void>((done) => {
    const off = host.onPeerIdChange((id) => {
      if (id) {
        off();
        done();
      }
    });
  });
}

async function waitForConnected(client: PeerClientService): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (client.getConnStatus() === "connected") return;
    await act(async () => {
      await new Promise<void>((done) => setTimeout(done, 0));
    });
  }
  throw new Error(`station never connected: ${client.getConnStatus()}`);
}

/**
 * Renders a scene on the main screen, fed by the mod, and then on a station
 * that joins afterwards and is fed only by what the host relays.
 *
 * - every emit goes to the mod's side once, as a quiet topic does in a game:
 *   nothing is re-sent on a timer, so a frame the relay loses stays lost
 * - the station connects after the last emit, so whatever it shows reached it
 *   through the host's backfill and its own subscriptions
 * - the host is the real `PeerHostService` behind the real `SitrepPeerRelay`,
 *   the station the real `PeerClientService` and `PeerTransport`, and the
 *   channel between them packs every message with PeerJS's own codec
 */
export async function renderScene(scene: ParityScene): Promise<SceneRenders> {
  const def = getComponent(scene.widgetId);
  if (!def) throw new Error(`${scene.widgetId} is not registered`);
  registerStockBodies();

  const wall = createFakeWallClock();
  const mod = new StubTransport();
  const main = buildScreen(mod, wall, scene.pinnedUt);
  const peerHost = new PeerHostService();
  const restoreResizeObserver = installSizedResizeObserver(
    gridPixels(scene.size),
  );
  let stationClient: PeerClientService | undefined;
  let stationTransport: PeerTransport | undefined;
  let station: Screen | undefined;
  const unmounts: Array<() => void> = [];

  try {
    await peerHost.start();
    await waitForHostPeerId(peerHost);

    const mainView = render(
      <ScreenTree screen={main} seat="main">
        <SitrepPeerRelay peerHost={peerHost} />
        <WidgetMount def={def} scene={scene} />
      </ScreenTree>,
    );
    unmounts.push(() => mainView.unmount());

    await act(async () => {
      for (const emit of scene.emits) {
        for (let i = 0; i < SUBSCRIBE_FRAMES; i++) {
          if (mod.isSubscribed(emit.channel)) break;
          main.frame();
          await nextAnimationFrame();
        }
        mod.emit(emit.channel, emit.value, emit.meta);
        main.frame();
        await nextAnimationFrame();
      }
    });
    await act(async () => {
      for (let i = 0; i < 2; i++) {
        main.frame();
        await nextAnimationFrame();
      }
    });
    await flushResizeObservers();

    const client = new PeerClientService();
    stationClient = client;
    act(() => client.connect(peerHost.shareCode));
    await waitForConnected(client);
    stationTransport = new PeerTransport(client);
    const stationScreen = buildScreen(stationTransport, wall, scene.pinnedUt);
    station = stationScreen;

    /*
     * The two screens are two browsers in production, each with its own
     * budgets. Here they share one process, so the station starts with an
     * empty window rather than inheriting the main screen's mount burst.
     */
    for (const budget of PerfBudget.getAll()) budget.resetWindow();
    const stationView = render(
      <ScreenTree screen={stationScreen} seat="station">
        <WidgetMount def={def} scene={scene} />
      </ScreenTree>,
    );
    unmounts.push(() => stationView.unmount());

    const mainHtml = markupOf(mainView.container);
    let stationHtml = "";
    let unchanged = 0;
    for (let i = 0; i < CONVERGE_FRAMES; i++) {
      await act(async () => {
        stationScreen.frame();
        await nextAnimationFrame();
        await new Promise<void>((done) => setTimeout(done, 0));
      });
      const now = markupOf(stationView.container);
      unchanged = now === stationHtml ? unchanged + 1 : 0;
      stationHtml = now;
      if (now === mainHtml || unchanged >= SETTLED_FRAMES) break;
    }
    await flushResizeObservers();
    stationHtml = markupOf(stationView.container);

    return {
      main: mainHtml,
      station: stationHtml,
      mainText: textOf(mainView.container),
      stationText: textOf(stationView.container),
    };
  } finally {
    for (const unmount of unmounts.reverse()) unmount();
    station?.client.dispose();
    stationTransport?.dispose();
    stationClient?.disconnect();
    main.client.dispose();
    peerHost.stop();
    restoreResizeObserver();
    await act(async () => {});
  }
}

/**
 * The first place the two renders part, with some context either side, so a
 * failure names what the station is missing rather than two blobs of markup.
 */
export function describeDifference(renders: SceneRenders): string {
  if (renders.mainText !== renders.stationText) {
    return `text differs\n  main:    ${renders.mainText}\n  station: ${renders.stationText}`;
  }
  const a = renders.main;
  const b = renders.station;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const from = Math.max(0, at - 120);
  return `markup differs at ${at}\n  main:    ...${a.slice(from, at + 160)}\n  station: ...${b.slice(from, at + 160)}`;
}
