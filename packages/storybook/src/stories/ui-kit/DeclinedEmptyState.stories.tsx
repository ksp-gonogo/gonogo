import { DeclinedEmptyState, Panel } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/DeclinedEmptyState",
  component: DeclinedEmptyState,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    declined: {
      reason: "beyond-horizon",
      note: "These orbital elements cannot be trusted this far ahead.",
    },
  },
} satisfies Meta<typeof DeclinedEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A drawing the model could not produce: the state word stands where it would be, with the reason in its tooltip. */
export const Inline: Story = {};

/** A reason with no state word of its own reads as no data. */
export const InputAbsent: Story = {
  args: {
    declined: {
      reason: "input-absent",
      note: "Nothing has said whether this trajectory is a conic.",
    },
  },
};

/** An integrating provider that has not computed this far reads like any other model past its horizon. */
export const BeyondIntegration: Story = {
  args: {
    declined: {
      reason: "beyond-horizon",
      note: "The trajectory is not computed this far ahead yet.",
    },
  },
};

/** A model that does not apply to this orbit. */
export const ModelInapplicable: Story = {
  args: {
    declined: {
      reason: "model-inapplicable",
      note: "The integrated trajectory could not be sampled.",
    },
  },
};

/** Two Uplinks registering a model for one Topic. */
export const Contested: Story = {
  args: {
    declined: {
      reason: "contested",
      note: "More than one Uplink models this Topic and none is used.",
    },
  },
};

/** A model that has not yet seen enough of its own Topic. */
export const InsufficientHistory: Story = {
  args: {
    declined: {
      reason: "insufficient-history",
      note: "The model needs more past samples than it holds.",
    },
  },
};

/** The frame asked for cannot be built, which is not a failure of the model. */
export const FrameUnavailable: Story = {
  args: {
    declined: {
      reason: "frame-unavailable",
      note: "The trajectory is fine; the frame it was asked for cannot be built from the bodies known here. Pick another frame.",
    },
  },
};

/** Filling the body of a panel in place of its drawing. */
export const FillsAPanel: Story = {
  render: (args) => (
    <div style={{ height: 240 }}>
      <Panel
        panelTitle="Orbit"
        sections={<DeclinedEmptyState {...args} layout="fill" />}
      />
    </div>
  ),
};
