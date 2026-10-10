import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  COMPACT_SIZE,
  LARGE_SIZE,
  MIN_SIZE,
  WIDE_SIZE,
} from "../../../scripts/landingStorySize";
import { withGonogoFrame } from "../../frame";
import { LandingDescentScene } from "../../landingDescentScenes";

const meta = {
  title: "Widgets/landing-status/Descent playback",
  component: LandingDescentScene,
  tags: ["playback"],
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 3, max: 36, step: 1 } },
    h: { control: { type: "range", min: 3, max: 40, step: 1 } },
  },
} satisfies Meta<typeof LandingDescentScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A lander falling from 8 km over the Mun that lights its engine at 700 m,
 * far too late to cancel the speed it has built, and meets the ground at about
 * 140 m/s. It is played at ten times real time at the widget's default size, which
 * holds the whole cross section; after impact the vessel's readings stop and the
 * last scene is held, drawn as last seen. Replay starts it over.
 */
export const CrashLanding: Story = {
  name: "Crash landing",
  args: { crash: true },
};

/** The crash at the wide size, where the touchdown plot sits beside the cross section. The tile is tall enough for the whole widget: the readouts under the plots scroll in a shorter one. */
export const CrashLandingWide: Story = {
  name: "Crash landing, wide",
  args: { crash: true, ...WIDE_SIZE },
};

/**
 * The same descent under a suicide burn that bleeds off the horizontal speed on
 * the way down and settles to a gentle touchdown, which the story runs to and
 * holds. Played at ten times real time at the widget's default size; Replay
 * starts it over.
 */
export const SafeLanding: Story = {
  name: "Safe landing",
  args: { crash: false },
};

/** The safe landing at the wide size, where the touchdown plot sits beside the cross section. */
export const SafeLandingWide: Story = {
  name: "Safe landing, wide",
  args: { crash: false, ...WIDE_SIZE },
};

/**
 * A shallow approach: the craft starts 4 km up, under five degrees below level, travelling mostly sideways at 100 m/s, and burns down to a soft touchdown. Played all the way to the touchdown, at the widget's default size.
 */
export const ShallowApproach: Story = {
  name: "Shallow approach",
  args: { shallow: true },
};

/** The shallow approach at the wide size, played all the way to the touchdown. */
export const ShallowApproachWide: Story = {
  name: "Shallow approach, wide",
  args: { shallow: true, ...WIDE_SIZE },
};

/**
 * A capsule coming into Kerbin's air from 25 km at about 570 m/s, falling ballistic until the air has slowed it, then opening a parachute and settling onto the grasslands. The atmospheric board: terminal speed, drag against weight, the regime, no suicide burn. Wide.
 */
export const AtmosphericApproachWide: Story = {
  name: "Atmospheric approach, wide",
  args: { world: "kerbin-land", ...WIDE_SIZE },
};

/**
 * The last stretch of a capsule's fall onto the ocean: from 7 km, canopy opening, to a splashdown at sea level. The ground strip reads the sea floor, as the mod does. Wide.
 */
export const OceanLandingWide: Story = {
  name: "Ocean landing, wide",
  args: { world: "kerbin-ocean", ...WIDE_SIZE },
};

/** The atmospheric approach at the widget's default size. */
export const AtmosphericApproach: Story = {
  name: "Atmospheric approach",
  args: { world: "kerbin-land" },
};

/** The ocean landing at the widget's default size. */
export const OceanLanding: Story = {
  name: "Ocean landing",
  args: { world: "kerbin-ocean" },
};

/** The atmospheric approach at the smallest size the widget takes, where its plots fold away into plain readouts. */
export const AtmosphericApproachSmallest: Story = {
  name: "Atmospheric approach, smallest",
  args: { world: "kerbin-land", ...MIN_SIZE },
};

/** The atmospheric approach in the smallest tile that shows it whole: the three plots side by side and every row in view. */
export const AtmosphericApproachCompact: Story = {
  name: "Atmospheric approach, compact",
  args: { world: "kerbin-land", ...COMPACT_SIZE },
};

/** The atmospheric approach in a large tile: the three plots grow with the room. */
export const AtmosphericApproachLarge: Story = {
  name: "Atmospheric approach, large",
  args: { world: "kerbin-land", ...LARGE_SIZE },
};

/** The ocean landing at the smallest size the widget takes, where its plots fold away into plain readouts. */
export const OceanLandingSmallest: Story = {
  name: "Ocean landing, smallest",
  args: { world: "kerbin-ocean", ...MIN_SIZE },
};

/** The ocean landing in the smallest tile that shows it whole: the three plots side by side and every row in view. */
export const OceanLandingCompact: Story = {
  name: "Ocean landing, compact",
  args: { world: "kerbin-ocean", ...COMPACT_SIZE },
};

/** The ocean landing in a large tile: the three plots grow with the room. */
export const OceanLandingLarge: Story = {
  name: "Ocean landing, large",
  args: { world: "kerbin-ocean", ...LARGE_SIZE },
};

/** A capsule's last stretch onto Eve's sea: five atmospheres of air, two thirds again Kerbin's gravity, and the sea in Eve's own colour. */
export const EveOceanLanding: Story = {
  name: "Eve ocean landing",
  args: { world: "eve-ocean" },
};
