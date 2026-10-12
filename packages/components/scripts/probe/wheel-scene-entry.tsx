/**
 * A scrolling dashboard for recording wheel behaviour: filler blocks around a
 * System View tile and a Map View tile, mounted on one live provider, so a
 * real wheel gesture can start on the page and carry over a diagram, or start
 * on a diagram. The widget library is imported by the generated entry that
 * bundles this file, so the same scene runs against any revision of it.
 */
import {
  ContributionsProvider,
  DashboardItemContext,
  getComponent,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { defaultDarkTheme, WidgetBody } from "@ksp-gonogo/ui-kit";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";

registerStockBodies();

/** The library revision under test supplies the provider, so it shares a context with the widgets it registers. */
let AlarmsLauncherProvider: AlarmsProvider;
type AlarmsProvider = (props: {
  launcher: () => void;
  creator: () => void;
  manager: { find: () => null; remove: () => void };
  children: ReactNode;
}) => ReactNode;

const KERBIN_MU = 3.5316e12;

function system() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: null,
      },
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
      {
        index: 2,
        name: "Minmus",
        parentIndex: 0,
        radius: 60_000,
        gravParameter: 1.7658e9,
        orbit: {
          sma: 47_000_000,
          ecc: 0,
          inc: 0.1,
          lan: 1,
          argPe: 0,
          meanAnomalyAtEpoch: 1,
          epoch: 100,
        },
      },
    ],
  };
}

function frame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const TILE_W = 620;
const TILE_H = 420;

function Block({ height, label }: { height: number; label: string }) {
  return (
    <div
      style={{
        height,
        margin: "16px 0",
        border: "1px dashed var(--color-border-strong)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-muted)",
      }}
    >
      {label}
    </div>
  );
}

function Tile({
  id,
  config,
  w,
  h,
  tileId,
}: {
  id: string;
  config: Record<string, unknown>;
  w: number;
  h: number;
  tileId: string;
}) {
  const def = getComponent(id);
  if (!def) throw new Error(`Scene: widget "${id}" not registered`);
  const meta = {
    componentId: def.id,
    contributionSlots: def.contributionSlots ?? [],
  };
  const body: ReactNode = createElement(
    WidgetMetaContext.Provider,
    { value: meta },
    createElement(
      ContributionsProvider,
      null,
      <AlarmsLauncherProvider
        launcher={() => {}}
        creator={() => {}}
        manager={{ find: () => null, remove: () => {} }}
      >
        {createElement(
          DashboardItemContext.Provider,
          { value: { instanceId: tileId } },
          createElement(WidgetBody, { def, config, id: tileId, w, h }),
        )}
      </AlarmsLauncherProvider>,
    ),
  );
  return (
    <div
      id={tileId}
      style={{
        width: TILE_W,
        height: TILE_H,
        overflow: "hidden",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-surface-panel)",
      }}
    >
      {body}
    </div>
  );
}

let activeRoot: ReturnType<typeof createRoot> | null = null;

/** Mounts the scene afresh, so every gesture starts from each diagram's whole view. */
async function mountScene(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Scene: #root missing");
  activeRoot?.unmount();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({ warpRate: () => 1, delaySeconds: () => 0 });
  const store = new TimelineStore(clock, {});
  activeRoot = createRoot(root);
  activeRoot.render(
    <ThemeProvider theme={defaultDarkTheme}>
      <TelemetryProvider client={client} store={store}>
        <div style={{ width: 700, margin: "0 auto", padding: "0 16px" }}>
          <Block height={420} label="Dashboard, above the diagrams" />
          <Tile
            tileId="scene-system"
            id="system-view"
            config={{ frame: "Kerbin" }}
            w={10}
            h={7}
          />
          <Block height={360} label="Dashboard, between the diagrams" />
          <Tile tileId="scene-map" id="map-view" config={{}} w={10} h={7} />
          <Block height={1000} label="Dashboard, below the diagrams" />
        </div>
      </TelemetryProvider>
    </ThemeProvider>,
  );
  await frame();
  for (const topic of ["system.bodies"]) {
    for (let i = 0; i < 60 && !transport.isSubscribed(topic); i++)
      await frame();
  }
  transport.emit("system.bodies", system());
  await frame();
}

declare global {
  interface Window {
    __mountScene: () => Promise<void>;
  }
}

export function installScene(provider: AlarmsProvider): void {
  AlarmsLauncherProvider = provider;
  window.__mountScene = mountScene;
}
