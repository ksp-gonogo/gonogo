import {
  type BodyPose,
  type CelestialBody,
  type SystemPoses,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { ephemerisFigureOf, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

function pose(
  index: number,
  currency: BodyPose["currency"],
  asOfUt: number | null = null,
): BodyPose {
  return {
    index,
    currency,
    atUt: asOfUt ?? 1_000,
    asOfUt,
    untilUt: null,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trueAnomaly: 0,
  };
}

function posesOf(...entries: BodyPose[]): SystemPoses {
  const poseByIndex: Record<number, BodyPose> = {};
  for (const entry of entries) poseByIndex[entry.index] = entry;
  return { ut: 1_000, poseByIndex };
}

const bodies = [{ index: 1 }, { index: 2 }] as CelestialBody[];
const PHASE_ANGLE = value("°", 44.2);

/** A phase angle between two planets, made by the figure-maker for the given poses. */
function PhaseAngle({ poses }: { poses: SystemPoses }) {
  return <Unit value={ephemerisFigureOf(poses, bodies)(PHASE_ANGLE)} />;
}

const meta = {
  title: "ui-kit/EphemerisFigure",
  component: PhaseAngle,
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof PhaseAngle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every body a fixed conic: the figure is exact and takes no mark. */
export const Exact: Story = {
  args: { poses: posesOf(pose(1, "exact"), pose(2, "exact")) },
};

/** One pose past its provider's horizon: the figure is held as of the oldest held pose. */
export const Held: Story = {
  args: { poses: posesOf(pose(1, "exact"), pose(2, "held", 400)) },
};

/** A modelled pose claims no exactness, so the figure takes no mark. */
export const Modelled: Story = {
  args: { poses: posesOf(pose(1, "exact"), pose(2, "modelled")) },
};
