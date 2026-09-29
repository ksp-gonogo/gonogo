import {
  Badge,
  Button,
  CloseIcon,
  Cluster,
  IconButton,
  SettingsIcon,
  Stack,
  Text,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

/** What a screen reader hears, shown under each example as story chrome since the component itself draws nothing. */
function Heard({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" tone="faint" aria-hidden="true">
      Screen reader hears: {children}
    </Text>
  );
}

const meta = {
  title: "ui-kit/VisuallyHidden",
  component: VisuallyHidden,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof VisuallyHidden>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Icon-only controls on a vessel row: the icons are all a sighted operator sees, the hidden words name each button. */
export const IconOnlyControls: Story = {
  render: () => (
    <Stack gap="related">
      <Cluster>
        <Text weight="semibold">Kerbal X</Text>
        <Cluster gap="related-dense">
          <IconButton type="button" onClick={() => {}}>
            <SettingsIcon />
            <VisuallyHidden>Configure Kerbal X</VisuallyHidden>
          </IconButton>
          <IconButton type="button" onClick={() => {}}>
            <CloseIcon />
            <VisuallyHidden>Remove Kerbal X from the watch list</VisuallyHidden>
          </IconButton>
        </Cluster>
      </Cluster>
      <Heard>
        "Configure Kerbal X, button", "Remove Kerbal X from the watch list,
        button"
      </Heard>
    </Stack>
  ),
};

/** A colour-coded net rate with the power state spoken as a word, announced only when the state changes. */
export const StateWordBesideColour: Story = {
  render: function Render() {
    const [charging, setCharging] = useState(true);
    return (
      <Stack gap="related">
        <Cluster justify="start">
          <Text tone="muted">Electric charge</Text>
          <Text tone={charging ? "go" : "nogo"} weight="semibold">
            {charging ? "+4.2" : "-1.8"} EC/s
          </Text>
          <span role="status" aria-live="polite">
            <VisuallyHidden>
              {charging ? "Charging" : "Draining"}
            </VisuallyHidden>
          </span>
        </Cluster>
        <Heard>
          "{charging ? "Charging" : "Draining"}", announced when it changes
        </Heard>
        <Cluster justify="start">
          <Button type="button" onClick={() => setCharging((c) => !c)}>
            {charging ? "Enter Kerbin's shadow" : "Leave Kerbin's shadow"}
          </Button>
        </Cluster>
      </Stack>
    );
  },
};

/** A badge whose visible glyph is shorthand, with the full meaning in hidden text. */
export const ExpandedAbbreviation: Story = {
  render: () => (
    <Stack gap="related">
      <Cluster justify="start">
        <Text>Jebediah Kerman</Text>
        <Badge severity="caution">
          <span aria-hidden="true">EVA</span>
          <VisuallyHidden>On extravehicular activity</VisuallyHidden>
        </Badge>
      </Cluster>
      <Heard>"Jebediah Kerman, On extravehicular activity"</Heard>
    </Stack>
  ),
};
