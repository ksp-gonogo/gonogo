import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import { AugmentSlot, Badge, Cluster, Section, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

/**
 * A slot only these stories fill, so the augments below reach no widget. Its
 * props type is per slot, and a slot no widget declares reads as never.
 */
const SLOT = "storybook.crew-badges";
const EMPTY_SLOT = "storybook.unbound";

registerAugment({
  id: "storybook:augment-slot-eva",
  augments: SLOT,
  priority: 1,
  component: () => (
    <Badge severity="info" size="sm">
      EVA
    </Badge>
  ),
} as never);

registerAugment({
  id: "storybook:augment-slot-veteran",
  augments: SLOT,
  priority: 0,
  component: () => (
    <Badge severity="nominal" size="sm">
      VETERAN
    </Badge>
  ),
} as never);

const meta = {
  title: "ui-kit/AugmentSlot",
  component: AugmentSlot,
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
    withGonogoFrame,
  ],
  args: { name: SLOT, props: {} as never },
} satisfies Meta<typeof AugmentSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two augments bound to one slot, drawn in priority order beside the host's own content. */
export const Filled: Story = {
  render: (args) => (
    <Section title="Jebediah Kerman">
      <Cluster>
        <Text>Pilot, level 3</Text>
        <AugmentSlot {...args} />
      </Cluster>
    </Section>
  ),
};

/** A slot nothing binds draws nothing, so the host reads as it would without any Uplink. */
export const Unbound: Story = {
  render: () => (
    <Section title="Jebediah Kerman">
      <Cluster>
        <Text>Pilot, level 3</Text>
        <AugmentSlot name={EMPTY_SLOT} props={{} as never} />
      </Cluster>
    </Section>
  ),
};
