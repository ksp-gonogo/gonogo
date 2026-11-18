import "@ksp-gonogo/components";
import { RequiresGuard, SeatGuard } from "@ksp-gonogo/components";
import {
  DashboardItemContext,
  getComponent,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import { registerUplinkTopic, wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  type TelemetryOverlay,
  TelemetryOverlayProvider,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  harnessTheme,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";

/*
 * Spike: real core widgets reading a design's predicted flight through the
 * same Topics they read in flight. The live stream says the game is in the
 * editor; the prediction is an overlay that answers only the vessel Topics.
 */

setQuantityLocale("en-GB");
registerUplinkTopic("prediction.flight");

registerDataSource({
  id: "sitrep",
  name: "Sitrep Stream",
  status: "connected",
  connect: async () => {},
  disconnect: () => {},
  schema: () => [],
  subscribe: () => () => {},
  onStatusChange: () => () => {},
  configSchema: () => [],
  configure: () => {},
  getConfig: () => ({}),
} as never);

const NOW_UT = 1_000_000;

interface Sample {
  t: number;
  [topic: string]: unknown;
}

interface Prediction {
  variant: string;
  samples: Sample[];
}

interface Tile {
  id: string;
  config?: Record<string, unknown>;
  /** Mount the overlay for this tile even though its definition does not list "design", to show what a widget that did not opt in would draw. */
  forceOverlay?: boolean;
  w: number;
  h: number;
}

interface Scene {
  screen: "main" | "pilot";
  scene: "Editor" | "Flight";
  prediction?: Prediction;
  /** Seconds after launch the cursor stands at. */
  cursor: number;
  /** The live stream's own vessel, for the in-flight comparison. */
  live?: Prediction;
  /** Publish the prediction also under its own Topic, for a chart that draws expected against actual. */
  alsoAsPredicted?: boolean;
  /** The Topics the overlay answers. Omit for the vessel Topics. */
  overlayTopics?: string[];
  overlayMode?: "design" | "default";
  tiles: Tile[];
  bodies: unknown;
  pois?: unknown[];
  heading: string;
}

const OVERLAY_TOPICS = [
  "vessel.flight",
  "vessel.propulsion",
  "vessel.structure",
  "vessel.identity",
];

const VESSEL_PAIRS = OVERLAY_TOPICS.map((t) => [t, t] as const);

let root: Root | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const IDENTITY = {
  vesselId: "design",
  name: "Splashdown Demo",
  vesselType: 0,
  situation: 1,
  parentBodyIndex: 1,
  launchUt: NOW_UT,
};

function publishSeries(
  fixture: StreamFixture,
  samples: Sample[],
  topics: ReadonlyArray<readonly [string, string]>,
): void {
  for (const [, topic] of topics) fixture.subscribe(topic);
  for (const s of samples) {
    const at = NOW_UT + s.t;
    for (const [field, topic] of topics) {
      const payload = field === "vessel.identity" ? IDENTITY : s[field];
      if (payload === undefined) continue;
      if (topic === "prediction.flight") {
        // A Topic no contract names is never subscribed on the stub's wire, so the gate is opened by hand.
        (
          fixture.transport as never as { subscribedTopics: Set<string> }
        ).subscribedTopics.add(topic);
      }
      fixture.emit(topic, payload, { validAt: at, deliveredAt: at });
    }
  }
}

function TileFrame({
  title,
  w,
  h,
  children,
}: {
  title: string;
  w: number;
  h: number;
  children: ReactNode;
}) {
  return (
    <div
      data-tile={title}
      style={{
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  if (root) {
    root.unmount();
    root = undefined;
  }

  const live = setupStreamFixture({ pinnedUt: NOW_UT + scene.cursor });
  const predicted = setupStreamFixture({ pinnedUt: NOW_UT + scene.cursor });

  const overlay: TelemetryOverlay | undefined = scene.prediction
    ? {
        mode: scene.overlayMode ?? "design",
        topics: scene.overlayTopics ?? OVERLAY_TOPICS,
        client: predicted.client,
        store: predicted.store,
        label: "Splashdown Demo, rev 15",
      }
    : undefined;

  const tiles = scene.tiles.map((tile) => {
    const def = getComponent(tile.id);
    if (!def) throw new Error(`no widget ${tile.id}`);
    const Body = def.component;
    const takesDesign =
      tile.forceOverlay === true || def.modes?.includes("design") === true;
    const inner = (
      <SeatGuard def={def}>
        <RequiresGuard
          requires={def.requires}
          channels={def.channels}
          modes={tile.forceOverlay ? ["default", "design"] : def.modes}
          title={def.name}
        >
          <Body
            id={tile.id}
            w={Math.round(tile.w / 75)}
            h={Math.round(tile.h / 75)}
            config={{ ...(def.defaultConfig ?? {}), ...(tile.config ?? {}) }}
          />
        </RequiresGuard>
      </SeatGuard>
    );
    return (
      <DashboardItemContext.Provider
        key={tile.id}
        value={{ instanceId: tile.id }}
      >
        <TileFrame title={def.name} w={tile.w} h={tile.h}>
          {/* The dashboard mounts a design only for a widget that can show one, and only at mission control. */}
          {takesDesign && scene.screen !== "pilot" ? (
            <TelemetryOverlayProvider overlay={overlay}>
              {inner}
            </TelemetryOverlayProvider>
          ) : (
            inner
          )}
        </TileFrame>
      </DashboardItemContext.Provider>
    );
  });

  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <ScreenProvider value={scene.screen}>
        <ModalProvider>
          {/* The overlay's own provider, mounted beside the tree rather than around it: it attaches the store and runs its frames without shadowing the live stream. */}
          <predicted.Provider>
            <span hidden />
          </predicted.Provider>
          <live.Provider>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-secondary, #aaa)",
                }}
              >
                {scene.heading}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  width: 1280,
                }}
              >
                {tiles}
              </div>
            </div>
          </live.Provider>
        </ModalProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );

  await twoFrames();
  live.subscribe("spaceCenter.scene");
  live.subscribe("career.mode");
  live.subscribe("trackingStation.bodies");
  live.emit("spaceCenter.scene", { scene: scene.scene });
  live.emit("career.mode", { mode: 1 });
  live.emit("trackingStation.bodies", scene.bodies);
  if (scene.pois) {
    live.subscribe("spaceCenter.pois");
    live.emit("spaceCenter.pois", scene.pois);
  }
  if (scene.live) {
    publishSeries(live, scene.live.samples, VESSEL_PAIRS);
  }
  if (scene.prediction) {
    publishSeries(predicted, scene.prediction.samples, [
      ...VESSEL_PAIRS,
      ...(scene.alsoAsPredicted
        ? ([["vessel.flight", "prediction.flight"]] as const)
        : []),
    ]);
  }
  await twoFrames();
  await new Promise((r) => setTimeout(r, 400));
  await twoFrames();
}

(
  window as unknown as { __renderDesignSeries: (s: Scene) => Promise<void> }
).__renderDesignSeries = renderScene;
