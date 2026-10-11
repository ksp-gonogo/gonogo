import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { LandingStill } from "../../landingStillScenes";

const meta = {
  title: "Widgets/landing-status/Stills",
  component: LandingStill,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingStill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The landing zone ring over flat ground, seen obliquely from 120 m. */
export const RingFlat120: Story = {
  args: { terrain: "flat", agl: 120, oblique: true },
};

/** The landing zone ring over flat ground, seen obliquely from 240 m. */
export const RingFlat240: Story = {
  args: { terrain: "flat", agl: 240, oblique: true },
};

/** The landing zone ring over slope30 ground, seen obliquely from 120 m. */
export const RingSlope30120: Story = {
  args: { terrain: "slope30", agl: 120, oblique: true },
};

/** The landing zone ring over slope30 ground, seen obliquely from 240 m. */
export const RingSlope30240: Story = {
  args: { terrain: "slope30", agl: 240, oblique: true },
};

/** The landing zone ring over slope60 ground, seen obliquely from 120 m. */
export const RingSlope60120: Story = {
  args: { terrain: "slope60", agl: 120, oblique: true },
};

/** The landing zone ring over slope60 ground, seen obliquely from 240 m. */
export const RingSlope60240: Story = {
  args: { terrain: "slope60", agl: 240, oblique: true },
};

/** The landing zone ring over ridge ground, seen obliquely from 120 m. */
export const RingRidge120: Story = {
  args: { terrain: "ridge", agl: 120, oblique: true },
};

/** The landing zone ring over ridge ground, seen obliquely from 240 m. */
export const RingRidge240: Story = {
  args: { terrain: "ridge", agl: 240, oblique: true },
};

/** The landing zone ring over a 90 m scarp that crosses it, seen obliquely from 120 m. */
export const RingScarp120: Story = {
  args: { terrain: "scarp", agl: 120, oblique: true },
};

/** The landing zone ring over a 90 m scarp that crosses it, seen obliquely from 240 m. */
export const RingScarp240: Story = {
  args: { terrain: "scarp", agl: 240, oblique: true },
};

/** The landing zone ring over crater ground, seen obliquely from 120 m. */
export const RingCrater120: Story = {
  args: { terrain: "crater", agl: 120, oblique: true },
};

/** The landing zone ring over crater ground, seen obliquely from 240 m. */
export const RingCrater240: Story = {
  args: { terrain: "crater", agl: 240, oblique: true },
};

/** The ground reference dots, from 300 m over the story's ground. */
export const GridDots300: Story = {
  args: { agl: 300 },
};

/** The ground reference dots, from 60 m over the story's ground. */
export const GridDots60: Story = {
  args: { agl: 60 },
};
