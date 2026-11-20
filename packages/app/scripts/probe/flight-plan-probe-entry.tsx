import "@ksp-gonogo/components";
import {
  getComponent,
  getModes,
  registerAugment,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import type {
  MissionMeta,
  ModeDefinition,
  ModeTimeline,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerContribution,
  type TelemetryOverlay,
  TelemetryOverlayProvider,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  harnessThemeFull,
  type StreamFixture,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  getReplaySessionController,
  ReplaySessionProvider,
} from "@ksp-gonogo/test-utils";
import {
  BannerPill,
  BannerStack,
  Fab,
  FabClusterProvider,
  FabClusterToggle,
  FullscreenEnterIcon,
  ModalProvider,
} from "@ksp-gonogo/ui";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import lowpass from "../../../components/src/LandingStatus/__fixtures__/rig/landing-lowpass.replay.json";
import { ModePane } from "../../src/components/ModePane/ModePane";
import { TileRegion } from "../../src/components/ModePane/TileRegion";

/* Probe: the built Flight Plan widget and the mode pane over stream fixtures, for the round's renders. */

setQuantityLocale("en-GB");

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

const LAUNCH_UT = 1_000_000;

const PLAN = {
  id: "mun-east",
  name: "Mun landing, east",
  reserve: 0.1,
  steps: [
    {
      id: "s1",
      kind: "launch",
      inputs: { heading: 90, clearAltitude: 10_000 },
      intents: [],
    },
    {
      id: "s2",
      kind: "reach-orbit",
      inputs: { body: "Kerbin", periapsis: 80_000 },
      needsDv: 3_400,
      script: { name: "ascent.ks", cpu: "main" },
      intents: [
        {
          group: 2,
          label: "Jettison fairing",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: ">=",
            value: 55_000,
          },
        },
        {
          group: 4,
          label: "Thermometer report",
          trigger: { kind: "time", at: 330 },
        },
      ],
    },
    {
      id: "s3",
      kind: "transfer",
      inputs: { to: "Mun", arrivalPeriapsis: 15_000 },
      needsDv: 860,
      intents: [],
    },
    {
      id: "s4",
      kind: "land",
      inputs: { on: "Mun" },
      needsDv: 890,
      intents: [
        {
          group: 1,
          label: "Extend landing legs",
          trigger: {
            kind: "value",
            quantity: "altitude",
            op: "<=",
            value: 2_000,
            body: "Mun",
          },
        },
      ],
    },
  ],
};

interface Scene {
  /** "editor" puts the game in the VAB; "flight" puts a vessel in flight at `t` seconds after lift-off. */
  game: "editor" | "flight";
  t: number;
  altitude: number;
  dv: number;
  /** The Δv on the pad. */
  padDv?: number;
  /** Whether AG2 has been pressed. */
  ag2: boolean;
  pane: boolean;
  widget?: { w: number; h: number; rows: number };
  /** Mount the widget under a design overlay holding the same flight, as a prediction. */
  predicted?: boolean;
  screen: { w: number; h: number };
  /** A predicted run to publish on the design store, scrubbed to `t` by the Timeline. */
  series?: ReadonlyArray<{
    t: number;
    altitude: number;
    dv: number;
    ap: number;
    pe: number;
    ag2: boolean;
  }>;
  /** The run's length, for the Timeline. */
  end?: number;
  /** The live orbit's apoapsis and periapsis heights, in metres. */
  ap?: number;
  pe?: number;
  /** The pane's title. */
  title?: string;
  /** Lay six placeholder tiles out in a grid filling the width beside the pane, as the dashboard does. */
  grid?: boolean;
  /** Contribute an Uplink's step kind under its own Add step heading, as the guide's example does. */
  contributed?: boolean;
  /** Play back a recorded flight (a low pass over the Mun), paused at this fraction of it. */
  replay?: number;
  /** Mount the screen's bottom-right menu and two event banners, as the main screen does. */
  chrome?: boolean;
  /** Add a section to the default mode, as an Uplink would. */
  defaultSection?: boolean;
}

function deliveredAt(raw: string): number | undefined {
  const frame = JSON.parse(raw) as { meta?: { deliveredAt?: unknown } };
  const at = frame.meta?.deliveredAt;
  return typeof at === "number" ? at : undefined;
}

function startReplay(fraction: number): void {
  const ats = lowpass.frames
    .map(deliveredAt)
    .filter((x): x is number => x !== undefined);
  const first = Math.min(...ats);
  const last = Math.max(...ats);
  const meta: MissionMeta = {
    id: "probe-lowpass",
    vesselName: "Muna 1",
    launchedAt: 0,
    firstFrameUt: first,
    lastFrameUt: last,
    frameCount: lowpass.frames.length,
  };
  const controller = getReplaySessionController();
  controller.start(meta, lowpass as never);
  controller.pause();
  controller.seekTo(first + (last - first) * fraction);
}

let root: Root | undefined;

function emitWorld(f: StreamFixture, s: Scene): void {
  f.emit("spaceCenter.scene", {
    scene: s.game === "editor" ? "Editor" : "Flight",
  });
  f.emit("trackingStation.bodies", {
    bodies: [
      {
        name: "Kerbin",
        index: 1,
        parentIndex: 0,
        radius: 600_000,
        surfaceGravity: 1,
        orbit: null,
      },
      {
        name: "Mun",
        index: 2,
        parentIndex: 1,
        radius: 200_000,
        surfaceGravity: 0.166,
        orbit: null,
      },
    ],
  });
}

function emitCraft(f: StreamFixture, s: Scene): void {
  f.emit("vessel.identity", {
    vesselId: "v1",
    name: "Mun Hopper Mk2",
    vesselType: 0,
    situation: s.game === "editor" ? 2 : 6,
    parentBodyIndex: 1,
    launchUt: LAUNCH_UT,
  });
  f.emit("vessel.flight", {
    latitude: 0,
    longitude: 0,
    altitudeAsl: s.altitude,
    altitudeTerrain: s.altitude,
    verticalSpeed: 400,
    surfaceSpeed: 1200,
    orbitalSpeed: 1400,
    gForce: 2,
    dynamicPressureKPa: 4,
    mach: 3,
    atmDensity: 0.01,
    externalTemperature: 250,
    atmosphericTemperature: 250,
  });
  if (s.ap !== undefined && s.pe !== undefined) {
    const ra = KERBIN_R + s.ap;
    const rp = KERBIN_R + s.pe;
    f.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: (ra + rp) / 2,
      ecc: (ra - rp) / (ra + rp),
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: LAUNCH_UT + s.t,
      mu: 3.5316e12,
      horizon: { kind: 1, trajectoryKind: 1 },
    });
  }
  f.emit("vessel.control", {
    actionGroups: [
      { index: 1, name: "AG1", state: false },
      { index: 2, name: "AG2", state: s.ag2 },
      { index: 4, name: "AG4", state: false },
    ],
  });
  f.emit("dv.summary", {
    stageCount: 4,
    totalDvVac: s.dv,
    totalDvAsl: s.dv,
    totalDvActual: s.dv,
  });
}

const KERBIN_R = 600_000;

function emitSeries(f: StreamFixture, s: Scene): void {
  for (const x of s.series ?? []) {
    const at = LAUNCH_UT + x.t;
    const meta = { validAt: at, deliveredAt: at };
    const ra = KERBIN_R + x.ap;
    const rp = KERBIN_R + x.pe;
    f.emit(
      "vessel.identity",
      {
        vesselId: "v1",
        name: "Mun Hopper Mk2",
        vesselType: 0,
        situation: x.t === 0 ? 2 : 6,
        parentBodyIndex: 1,
        launchUt: x.t === 0 ? null : LAUNCH_UT,
      },
      meta,
    );
    f.emit(
      "vessel.flight",
      {
        latitude: 0,
        longitude: 0,
        altitudeAsl: x.altitude,
        altitudeTerrain: x.altitude,
        verticalSpeed: 100,
        surfaceSpeed: 1000,
        orbitalSpeed: 1500,
        gForce: 1,
        dynamicPressureKPa: 1,
        mach: 2,
        atmDensity: 0.01,
        externalTemperature: 250,
        atmosphericTemperature: 250,
      },
      meta,
    );
    f.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: (ra + rp) / 2,
        ecc: (ra - rp) / (ra + rp),
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: at,
        mu: 3.5316e12,
        horizon: { kind: 1, trajectoryKind: 1 },
      },
      meta,
    );
    f.emit(
      "vessel.control",
      {
        actionGroups: [
          { index: 1, name: "AG1", state: false },
          { index: 2, name: "AG2", state: x.ag2 },
          { index: 4, name: "AG4", state: false },
        ],
      },
      meta,
    );
    f.emit(
      "dv.summary",
      {
        stageCount: 4,
        totalDvVac: x.dv,
        totalDvAsl: x.dv,
        totalDvActual: x.dv,
      },
      meta,
    );
  }
}

function emitPad(f: StreamFixture, s: Scene): void {
  f.emit("vessel.identity", {
    vesselId: "v1",
    name: "Mun Hopper Mk2",
    vesselType: 0,
    situation: 2,
    parentBodyIndex: 1,
    launchUt: null,
  });
  const dv = s.padDv ?? s.dv;
  f.emit("dv.summary", {
    stageCount: 4,
    totalDvVac: dv,
    totalDvAsl: dv,
    totalDvActual: dv,
  });
}

function Tile({
  w,
  h,
  title,
  children,
}: {
  w: number;
  h: number;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-regular)",
        background: "var(--color-surface-panel)",
        color: "var(--color-text-dim)",
        fontSize: 11,
        letterSpacing: "0.08em",
      }}
    >
      {children ?? <div style={{ padding: 8 }}>{title}</div>}
    </div>
  );
}

/** The main screen's bottom-right menu, with three of its buttons, and two banners in its event stack, in the tiles' region as the screen mounts them. */
function ScreenChrome() {
  return (
    <TileRegion>
      <FabClusterProvider>
        <FabClusterToggle />
        {[84, 144, 204].map((bottom) => (
          <Fab key={bottom} bottom={bottom} aria-label={`Menu item ${bottom}`}>
            <FullscreenEnterIcon />
          </Fab>
        ))}
      </FabClusterProvider>
      <BannerStack>
        <BannerPill accent="var(--color-caution-mark)">
          Unscheduled warp: 4x
        </BannerPill>
        <BannerPill accent="var(--color-info-mark)">
          Scene change: vehicle editor
        </BannerPill>
      </BannerStack>
    </TileRegion>
  );
}

async function render(scene: Scene): Promise<void> {
  const detent = localStorage.getItem("gonogo.modePane.detent");
  localStorage.clear();
  if (detent) localStorage.setItem("gonogo.modePane.detent", detent);
  localStorage.setItem("gonogo.flightPlans", JSON.stringify([PLAN]));
  localStorage.setItem(
    "gonogo.flightPlans.applied",
    JSON.stringify({ editor: PLAN.id, v1: PLAN.id }),
  );
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");
  root?.unmount();
  const pinnedUt = LAUNCH_UT + scene.t;
  const live = setupStreamFixture({ pinnedUt });
  const design = setupStreamFixture({ pinnedUt });
  const Widget = getComponent("flight-plan")?.component;
  if (!Widget) throw new Error("flight-plan is not registered");
  const overlay: TelemetryOverlay | undefined = scene.predicted
    ? {
        mode: "design",
        topics: ["vessel", "dv"],
        client: design.client,
        store: design.store,
      }
    : undefined;
  const seriesTimeline = (): ModeTimeline => {
    // Probe only: the run's clock is pinned by the scene, so the cursor's moment is held here.
    const [t, setT] = useState(scene.t);
    return {
      start: LAUNCH_UT,
      end: LAUNCH_UT + (scene.end ?? 400),
      at: LAUNCH_UT + t,
      launchUt: LAUNCH_UT,
      seek: (ut) => {
        setT(ut - LAUNCH_UT);
        design.store.clock.scrubTo(ut);
      },
      marks: [
        { ut: LAUNCH_UT + 58, label: "1" },
        { ut: LAUNCH_UT + 232, label: "2" },
        { ut: LAUNCH_UT + 330, label: "AG4" },
      ],
    };
  };
  const core = (id: string): ModeDefinition => {
    const def = getModes().find((m) => m.id === id);
    if (!def) throw new Error(`mode ${id} is not registered`);
    return def;
  };
  const paneMode: ModeDefinition =
    scene.game === "editor"
      ? scene.series
        ? { ...core("design"), useTimeline: seriesTimeline }
        : core("design")
      : core(scene.replay !== undefined ? "replay" : "default");
  const widget = scene.widget ? (
    <Tile w={scene.widget.w} h={scene.widget.h}>
      <TelemetryOverlayProvider overlay={overlay}>
        <Widget config={{}} id="plan" w={6} h={scene.widget.rows} />
      </TelemetryOverlayProvider>
    </Tile>
  ) : null;
  if (scene.replay !== undefined) startReplay(scene.replay);
  if (scene.defaultSection) {
    registerAugment({
      id: "example:guidance",
      augments: "mode-sections.default",
      label: "Guidance",
      component: () => (
        <div style={{ color: "var(--color-text-secondary)" }}>
          Ascent program armed
        </div>
      ),
    });
  }
  if (scene.contributed) {
    registerContribution({
      id: "example:ascent",
      contributes: "flight-plan.steps",
      compute: () => [
        {
          id: "example.ascent",
          name: "Guided ascent",
          group: "Example",
          inputs: {
            altitude: { label: "Orbit", unit: "km" as const, default: 80_000 },
          },
        },
      ],
    });
  }
  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessThemeFull}>
      <ScreenProvider value="main">
        <ModalProvider>
          <live.Provider>
            <ReplaySessionProvider>
              <design.Provider>
                <span />
              </design.Provider>
              <div
                style={{
                  width: scene.screen.w,
                  height: scene.screen.h,
                  position: "relative",
                  // Anchors the menu and banners, which are fixed to the screen, to this box.
                  transform: "translateZ(0)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 8 }}>
                  {scene.pane ? (
                    <ModePane
                      key={paneMode.id}
                      mode={paneMode}
                      title={
                        scene.title ??
                        (scene.game === "editor"
                          ? "Mun Hopper Mk2 rev 3"
                          : "Mun Hopper Mk2")
                      }
                    />
                  ) : null}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={
                        scene.grid
                          ? {
                              flex: 1,
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fill, minmax(280px, 1fr))",
                              gridAutoRows: 200,
                              gap: 8,
                              padding: 8,
                            }
                          : {
                              flex: 1,
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                              padding: 8,
                              alignContent: "flex-start",
                            }
                      }
                    >
                      {scene.grid
                        ? [
                            "TWR",
                            "ORBITAL ASCENT",
                            "GROUND TRACK",
                            "GRAPH",
                            "ATMOSPHERE PROFILE",
                            "FUEL STATUS",
                          ].map((t) => (
                            <div
                              key={t}
                              style={{
                                border: "1px solid var(--color-border-subtle)",
                                borderRadius: "var(--radius-regular)",
                                background: "var(--color-surface-panel)",
                                color: "var(--color-text-dim)",
                                fontSize: 11,
                                letterSpacing: "0.08em",
                                padding: 8,
                              }}
                            >
                              {t}
                            </div>
                          ))
                        : null}
                      {scene.pane && !scene.grid ? (
                        <Tile
                          w={260}
                          h={220}
                          title={scene.game === "editor" ? "TWR" : "NAVBALL"}
                        />
                      ) : null}
                      {widget}
                      {scene.pane && !scene.widget && !scene.grid ? (
                        <Tile w={260} h={220} title="GRAPH" />
                      ) : null}
                    </div>
                  </div>
                </div>
                {scene.chrome ? <ScreenChrome /> : null}
              </div>
            </ReplaySessionProvider>
          </live.Provider>
        </ModalProvider>
      </ScreenProvider>
    </ThemeProvider>,
  );
  await new Promise((r) => setTimeout(r, 50));
  emitWorld(live, scene);
  if (scene.series) {
    emitWorld(design, scene);
    // The craft in the editor, as the live game reports it, which the pane scores the plan against.
    live.emit("dv.summary", {
      stageCount: 4,
      totalDvVac: scene.padDv ?? scene.dv,
      totalDvAsl: scene.padDv ?? scene.dv,
      totalDvActual: scene.padDv ?? scene.dv,
    });
    // Walk the cursor up the run so the plan sees the pad, then each moment, as it would under a drag.
    for (const x of scene.series) {
      if (x.t > scene.t) break;
      design.store.clock.scrubTo(LAUNCH_UT + x.t);
      emitSeries(design, { ...scene, series: [x] });
      await new Promise((r) => setTimeout(r, 60));
    }
    emitSeries(design, scene);
    design.store.clock.scrubTo(LAUNCH_UT + scene.t);
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    return;
  }
  const target = scene.predicted ? design : live;
  if (scene.predicted) emitWorld(design, scene);
  if (scene.game === "flight" || scene.predicted) {
    // The craft on the pad first, so the plan holds the Δv it launched with.
    emitPad(target, scene);
    await new Promise((r) => setTimeout(r, 120));
  }
  emitCraft(target, scene);

  await new Promise((r) => setTimeout(r, 200));

  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
}

(
  window as unknown as { __renderFlightPlan: typeof render }
).__renderFlightPlan = render;
