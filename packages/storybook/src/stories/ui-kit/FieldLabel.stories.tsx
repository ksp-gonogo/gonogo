import {
  ConfigForm,
  Field,
  FieldLabel,
  FieldRow,
  Input,
  Select,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/FieldLabel",
  component: FieldLabel,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof FieldLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Labels over several controls: the uppercase caption names each one, and clicking it focuses the control. */
export const OverControls: Story = {
  render: function Render() {
    const [crew, setCrew] = useState("Jebediah Kerman");
    const [seat, setSeat] = useState("command");
    return (
      <ConfigForm>
        <Field>
          <FieldLabel htmlFor="l-crew">Crew member</FieldLabel>
          <Input
            id="l-crew"
            value={crew}
            onChange={(e) => setCrew(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="l-seat">Seat</FieldLabel>
          <Select
            id="l-seat"
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
          >
            <option value="command">Mk1 Command Pod</option>
            <option value="lab">Mobile Processing Lab</option>
            <option value="cabin">Hitchhiker Storage Container</option>
          </Select>
        </Field>
      </ConfigForm>
    );
  },
};

/** A label beside its control in a row, the inline form of the same caption. */
export const Inline: Story = {
  render: () => (
    <FieldRow>
      <FieldLabel htmlFor="l-warp">Warp rate</FieldLabel>
      <Input
        id="l-warp"
        type="number"
        defaultValue={50}
        style={{ width: 96 }}
      />
    </FieldRow>
  ),
};

/** A long label wraps rather than truncating, so the whole name stays readable. */
export const LongLabel: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="l-long">
        Minimum electric charge before the relay antenna is retracted
      </FieldLabel>
      <Input id="l-long" type="number" defaultValue={25} />
    </Field>
  ),
};
