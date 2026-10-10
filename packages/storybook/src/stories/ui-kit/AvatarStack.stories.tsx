import { AvatarStack, Cluster, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const PEOPLE = [
  { id: "a", name: "Ares 4" },
  { id: "w", name: "Woomera Range" },
  { id: "j", name: "Jeb Kerman" },
  { id: "k", name: "Kennedy Flight" },
  { id: "b", name: "Bill Kerman" },
];

const meta = {
  title: "ui-kit/AvatarStack",
  component: AvatarStack,
  decorators: [withGonogoFrame],
  args: { items: PEOPLE.slice(0, 2), label: "Speaking" },
} satisfies Meta<typeof AvatarStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** One, two, three and five people in a stack of three places: each takes the same width, and the last two fold into a count. */
export const FixedFootprint: Story = {
  render: () => (
    <Cluster>
      {[0, 1, 2, 3, 5].map((count) => (
        <div
          key={count}
          style={{ outline: "1px dashed currentColor", padding: 2 }}
        >
          <AvatarStack items={PEOPLE.slice(0, count)} max={3} />
        </div>
      ))}
      <Text size="xs">0, 1, 2, 3 and 5 people</Text>
    </Cluster>
  ),
};

/** An item with `onSelect` is a button; the others are plain marks. */
export const Selectable: Story = {
  args: {
    items: PEOPLE.slice(0, 3).map((person, i) =>
      i === 0 ? person : { ...person, onSelect: () => {} },
    ),
  },
};
