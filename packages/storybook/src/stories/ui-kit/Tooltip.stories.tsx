import { Badge, Button, Cluster, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

const meta = {
  title: "ui-kit/Tooltip",
  component: Tooltip,
  decorators: [
    (Story) => (
      <div style={{ width: 420, minHeight: 160 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: {
    text: "Saves the game first, and refuses if KSP will not save here",
    children: <Button>Tracking Station</Button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest the control is alone; hover or keyboard focus opens the tip beside it, and Escape closes it. */
export const OnControl: Story = {};

/** A readout that is not a control becomes a tab stop only when asked, so the keyboard can reach its note. */
export const OnReadout: Story = {
  args: {
    text: "Held since Y1 D12",
    focusable: true,
    children: <Unit value={held("km", 212)} />,
  },
};

/** Several tips on one row: each control names its own note. */
export const OnARow: Story = {
  render: () => (
    <Cluster justify="start">
      <Tooltip text="Resume the warp">
        <Button>Resume</Button>
      </Tooltip>
      <Tooltip text="Warp toward the next alarm" focusable>
        <Badge tone="go">Armed</Badge>
      </Tooltip>
    </Cluster>
  ),
};
