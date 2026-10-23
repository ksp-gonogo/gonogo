import { Quality } from "@ksp-gonogo/sitrep-sdk";
import groundTrackFixture from "../../src/GroundTrack/__fixtures__/kerbin-lko-equator.json";
import trackingStationFixture from "../../src/TrackingStation/__fixtures__/kerbin-orbit-no-target.json";
import { LAYER_SCENES } from "../orbitSpreadScenarios";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

type Layer = "system-view" | "map";

interface Api {
  mount: (layer: Layer, sceneId: string, w: number, h: number) => Promise<void>;
}

interface Emit {
  channel: string;
  value: Record<string, unknown>;
}

const frame = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );

let mounted: ProbeMount | undefined;

/** The fixture's own stream, its orbit given a departure envelope of the scene's band that runs to one period past the observation. */
function sceneFixture(layer: Layer, sceneId: string) {
  const scene = LAYER_SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"`);
  const base = layer === "map" ? groundTrackFixture : trackingStationFixture;
  const stream = base._stream as unknown as {
    pinnedUt: number;
    emits: Emit[];
  };
  /* The fake wall clock starts near zero, so a scene read off it carries its own instants from zero too. */
  const shift = stream.pinnedUt;
  const startUt = 0;
  const orbit = stream.emits.find((e) => e.channel === "vessel.orbit")
    ?.value as {
    sma: number;
    epoch: number;
    patches: {
      period: number;
      startUt: number;
      endUt: number;
      epoch: number;
    }[];
  };
  orbit.epoch -= shift;
  for (const patch of orbit.patches) {
    patch.startUt -= shift;
    patch.endUt -= shift;
    patch.epoch -= shift;
  }
  const period = orbit.patches[0].period;
  const metres = scene.halfWidthDegrees * (Math.PI / 180) * orbit.sma;
  const observed = { validAt: startUt, quality: Quality.OnRails };
  const emits = stream.emits.map((e) =>
    e.channel === "vessel.orbit"
      ? {
          ...e,
          meta: { ...(e as { meta?: object }).meta, ...observed },
          value: {
            ...e.value,
            horizon: {
              kind: 2,
              trajectoryKind: 2,
              untilUt: startUt + period,
              departure: [
                {
                  untilUt: startUt + period,
                  metres,
                  metresPerSecond: 0.01,
                },
              ],
            },
          },
        }
      : {
          ...e,
          // The map is drawn offset by a quarter turn, so this puts the craft in its western half and the carried band on screen.
          value:
            e.channel === "vessel.flight"
              ? { ...e.value, longitude: -150 }
              : e.value,
          meta: { ...(e as { meta?: object }).meta, ...observed },
        },
  );
  const viewAfter = scene.pastHorizon ? period + 400 : period / 8;
  return {
    viewAfter,
    fixture: {
      ...base,
      _stream: {
        ...stream,
        pinnedUt: undefined,
        delaySeconds: viewAfter,
        emits,
      },
    },
  };
}

(window as unknown as { __orbitSpreadLayers: Api }).__orbitSpreadLayers = {
  async mount(layer, sceneId, w, h) {
    const { fixture, viewAfter } = sceneFixture(layer, sceneId);
    const root = document.getElementById("root") as HTMLElement;
    mounted = mountProbe(
      root,
      probePayload({
        widgetId: layer === "map" ? "ground-track" : "tracking-station",
        fixture: fixture as Record<string, unknown>,
        size: { w, h },
        asDashboard: true,
      }),
    );
    await mounted.ready;
    await frame();
    await frame();
    await frame();
    mounted.advance(viewAfter);
    await frame();
    await frame();
  },
};
