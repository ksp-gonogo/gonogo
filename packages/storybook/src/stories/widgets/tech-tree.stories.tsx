import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { TechTreeCareerScene } from "../../techTreeScenes";

const meta = {
  title: "Widgets/tech-tree/Career playback",
  component: TechTreeCareerScene,
  decorators: [withGonogoFrame],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 5, max: 36, step: 1 } },
    h: { control: { type: "range", min: 4, max: 40, step: 1 } },
  },
} satisfies Meta<typeof TechTreeCareerScene>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A new career with nothing researched. Flights hand in science, the balance
 * and the researchable count climb with it, and the cheapest node the balance
 * reaches is bought each time, so the graph fills outward from the start node.
 * Replay starts the career over.
 */
export const CareerUnlocking: Story = {
  name: "Career unlocking nodes",
};
