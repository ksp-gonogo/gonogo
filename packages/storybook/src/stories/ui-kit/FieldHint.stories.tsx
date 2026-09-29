import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/FieldHint",
  component: FieldHint,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof FieldHint>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hints under several fields: each explains its own control in smaller, fainter type than the label. */
export const UnderFields: Story = {
  render: function Render() {
    const [throttle, setThrottle] = useState("65");
    const [stage, setStage] = useState("3");
    return (
      <ConfigForm>
        <Field>
          <FieldLabel htmlFor="h-throttle">Throttle limit (%)</FieldLabel>
          <Input
            id="h-throttle"
            type="number"
            value={throttle}
            onChange={(e) => setThrottle(e.target.value)}
          />
          <FieldHint>Caps every engine on the active stage.</FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="h-stage">Abort to stage</FieldLabel>
          <Select
            id="h-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="1">Stage 1: launch escape</option>
            <option value="2">Stage 2: decoupler</option>
            <option value="3">Stage 3: parachutes</option>
          </Select>
          <FieldHint>Fired in order when ABORT is armed.</FieldHint>
        </Field>
      </ConfigForm>
    );
  },
};

/** A hint carrying a live reading, so the operator sees the current figure beside the one they type. */
export const WithReading: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="h-alt">Alarm altitude (m)</FieldLabel>
      <Input id="h-alt" type="number" defaultValue={70_000} />
      <FieldHint>
        Kerbal X is at <Unit value={live("m", 45_210)} />
      </FieldHint>
    </Field>
  ),
};

/** A hint carrying a held reading: the figure is marked held rather than live. */
export const WithHeldReading: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="h-fuel">Low fuel warning (units)</FieldLabel>
      <Input id="h-fuel" type="number" defaultValue={400} />
      <FieldHint>
        Last reported <Unit value={held("units", 1_260)} /> liquid fuel
      </FieldHint>
    </Field>
  ),
};
