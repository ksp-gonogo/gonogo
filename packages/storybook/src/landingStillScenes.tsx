import {
  integrate,
  type Relief,
  RIDGE_APPROACH_DESCENT,
  STORY_RELIEF,
  streamFixture,
} from "../../components/scripts/landingDescentModel";
import { RequiresGuard } from "../../components/src/shared/RequiresGuard";
import { DEFAULT_SIZE } from "../scripts/landingStorySize";
import { WidgetScene } from "./WidgetScene";

/** Ground the ring is drawn over in the stills: the slope rises toward the site, the way the craft flies. */
export const RING_TERRAINS = {
  flat: () => 0,
  slope30: (east: number) => 0.3 * east,
  slope60: (east: number) => 0.6 * east,
  scarp: (east: number, north: number) =>
    90 / (1 + Math.exp(-(east - 6) / 9)) + 6 * Math.sin(north / 14),
  ridge: (east: number) => 18 * Math.exp(-(((east - 18) / 12) ** 2)),
  crater: (east: number, north: number) => {
    const d = Math.hypot(east, north);
    return (
      (d < 45 ? -12 * (1 - (d / 45) ** 2) : 0) +
      8 * Math.exp(-(((d - 48) / 8) ** 2))
    );
  },
} satisfies Record<string, Relief>;

export type RingTerrain = keyof typeof RING_TERRAINS;

export interface LandingStillProps {
  /** The ground under the descent; the story's own relief when omitted. */
  terrain?: RingTerrain;
  /** Height above the ground the still is taken at, metres. */
  agl?: number;
  /** The low approach, 300 m short of the site and looking at it obliquely, instead of the deep descent that arrives nearly overhead. */
  oblique?: boolean;
  w?: number;
  h?: number;
}

/** Landing Status held on one frame of the safe descent at a height, over a chosen ground. */
export function LandingStill({
  terrain,
  agl = 300,
  oblique = false,
  w = DEFAULT_SIZE.w,
  h = DEFAULT_SIZE.h,
}: LandingStillProps) {
  const frames = integrate(oblique ? { start: RIDGE_APPROACH_DESCENT } : {});
  const frame =
    frames.find((f) => !f.landed && f.aglMeters <= agl) ?? frames[0];
  const fixture = streamFixture(
    frame,
    3,
    "descent",
    "",
    terrain ? RING_TERRAINS[terrain] : STORY_RELIEF,
  );
  return (
    <WidgetScene
      key={`${terrain}-${agl}-${oblique}`}
      widgetId="landing-status"
      fixture={fixture}
      w={w}
      h={h}
    />
  );
}

/** Landing Status on a dashboard whose game is in a scene other than the flight: the gate every flight widget stands behind. */
export function LandingOutsideFlight({
  scene,
  w = DEFAULT_SIZE.w,
  h = DEFAULT_SIZE.h,
}: {
  scene: "SpaceCenter" | "Editor" | "TrackingStation" | "MainMenu";
  w?: number;
  h?: number;
}) {
  return (
    <WidgetScene
      key={scene}
      widgetId="landing-status"
      fixture={{
        _meta: { scenario: `the game is in ${scene}`, synthetic: true },
        _stream: {
          pinnedUt: 10,
          emits: [
            {
              channel: "spaceCenter.scene",
              value: { scene, launchSite: null },
            },
          ],
        },
      }}
      w={w}
      h={h}
      wrap={(tree) => (
        <RequiresGuard requires={["flight"]} title="LANDING">
          {tree}
        </RequiresGuard>
      )}
    />
  );
}
