import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { ResearchAndDevelopmentCareerScene } from "../../researchAndDevelopmentScenes";

const meta = {
  title: "Widgets/research-and-development/Career playback",
  component: ResearchAndDevelopmentCareerScene,
  decorators: [withGonogoFrame],
  tags: ["playback"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    w: { control: { type: "range", min: 5, max: 36, step: 1 } },
    h: { control: { type: "range", min: 4, max: 40, step: 1 } },
  },
} satisfies Meta<typeof ResearchAndDevelopmentCareerScene>;

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
