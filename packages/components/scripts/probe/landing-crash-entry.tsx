import {
  AIR,
  crashEmits,
  emitsOf,
  playbackOf,
  streamOf,
} from "../../../storybook/scripts/landingPlaybackModel";
import { integrateAtmosphere, LOW_DESCENT } from "../landingAtmosphereModel";
import { integrate } from "../landingDescentModel";
import { probePayload } from "./payload";
import { mountProbe, type ProbeMount } from "./probe-entry";

type Ending = "crash" | "landed" | "splashed";

interface Api {
  mount: (ending: Ending, w: number, h: number) => Promise<number>;
  playTo: (index: number) => Promise<void>;
  crash: () => Promise<void>;
}

const frame = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );

let mounted: ProbeMount | undefined;
let all: ReturnType<typeof integrate>;
let frames: ReturnType<typeof playbackOf>["played"];
let world: "mun" | "kerbin-ocean" = "mun";
let cursor = 0;

(window as unknown as { __landingCrash: Api }).__landingCrash = {
  async mount(ending, w, h) {
    world = ending === "splashed" ? "kerbin-ocean" : "mun";
    all =
      world === "mun"
        ? integrate({ crash: ending === "crash", start: undefined })
        : integrateAtmosphere(AIR["kerbin-ocean"], LOW_DESCENT);
    frames = playbackOf(all, ending === "crash").played;
    cursor = 0;
    const root = document.getElementById("root") as HTMLElement;
    mounted = mountProbe(
      root,
      probePayload({
        widgetId: "landing-status",
        fixture: streamOf(frames[0], world, "") as Record<string, unknown>,
        size: { w, h },
        asDashboard: true,
      }),
    );
    await mounted.ready;
    await frame();
    return frames.length;
  },
  async playTo(index) {
    const end = Math.min(index, frames.length - 1);
    while (cursor < end) {
      cursor += 1;
      for (const e of emitsOf(frames[cursor], world))
        mounted?.emit(e.channel, e.value, e.meta);
      if (cursor % 20 === 0) await frame();
    }
    await frame();
    await frame();
  },
  async crash() {
    for (const e of crashEmits(all[all.length - 1]))
      mounted?.emit(e.channel, e.value, e.meta);
    await mounted?.stopArriving();
    await frame();
    await frame();
  },
};
