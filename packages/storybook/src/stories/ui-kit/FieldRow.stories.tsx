import {
  ConfigForm,
  FieldLabel,
  FieldRow,
  Input,
  Select,
  Switch,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/FieldRow",
  component: FieldRow,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof FieldRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several rows of label and control, each laid out side by side and centred on one line. */
export const Settings: Story = {
  render: function Render() {
    const [warp, setWarp] = useState("50");
    const [units, setUnits] = useState("metric");
    return (
      <ConfigForm>
        <FieldRow>
          <FieldLabel htmlFor="r-warp">Warp rate</FieldLabel>
          <Input
            id="r-warp"
            type="number"
            value={warp}
            onChange={(e) => setWarp(e.target.value)}
            style={{ width: 96 }}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel htmlFor="r-units">Units</FieldLabel>
          <Select
            id="r-units"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            style={{ width: 160 }}
          >
            <option value="metric">Metric</option>
            <option value="kerbal">Kerbal</option>
          </Select>
        </FieldRow>
      </ConfigForm>
    );
  },
};

/** A column of switch rows, the usual shape for a group of on/off settings. */
export const Switches: Story = {
  render: function Render() {
    const [sas, setSas] = useState(true);
    const [rcs, setRcs] = useState(false);
    const [gear, setGear] = useState(true);
    return (
      <ConfigForm>
        <FieldRow>
          <Switch checked={sas} onChange={setSas} label="SAS on launch" />
        </FieldRow>
        <FieldRow>
          <Switch checked={rcs} onChange={setRcs} label="RCS on launch" />
        </FieldRow>
        <FieldRow>
          <Switch
            checked={gear}
            onChange={setGear}
            label="Retract gear above 500 m"
          />
        </FieldRow>
      </ConfigForm>
    );
  },
};

/** A full-width control beside its label: the control takes the room the label leaves. */
export const FullWidthControl: Story = {
  render: function Render() {
    const [target, setTarget] = useState("Mun Lander II");
    return (
      <FieldRow>
        <FieldLabel htmlFor="r-target">Target</FieldLabel>
        <Input
          id="r-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </FieldRow>
    );
  },
};
