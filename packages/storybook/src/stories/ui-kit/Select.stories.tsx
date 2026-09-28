import {
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  Select,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 320 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Select",
  component: Select,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const VESSELS = [
  { id: "kerbal-x", name: "Kerbal X" },
  { id: "mun-lander", name: "Mun Lander II" },
  { id: "relay-1", name: "KerbNet Relay 1" },
  { id: "station", name: "Minmus Station" },
];

/** A labelled vessel picker: choosing an option updates the line below it. */
export const Vessels: Story = {
  render: function Render() {
    const [vessel, setVessel] = useState("mun-lander");
    return (
      <Field>
        <FieldLabel htmlFor="s-vessel">Active vessel</FieldLabel>
        <Select
          id="s-vessel"
          value={vessel}
          onChange={(e) => setVessel(e.target.value)}
        >
          {VESSELS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <FieldHint>{`Tracking ${VESSELS.find((v) => v.id === vessel)?.name}`}</FieldHint>
      </Field>
    );
  },
};

/** Options grouped by what they orbit, through native optgroups. */
export const Grouped: Story = {
  render: function Render() {
    const [body, setBody] = useState("mun");
    return (
      <Field>
        <FieldLabel htmlFor="s-body">Target body</FieldLabel>
        <Select
          id="s-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        >
          <optgroup label="Kerbol">
            <option value="moho">Moho</option>
            <option value="eve">Eve</option>
            <option value="kerbin">Kerbin</option>
            <option value="duna">Duna</option>
          </optgroup>
          <optgroup label="Kerbin">
            <option value="mun">Mun</option>
            <option value="minmus">Minmus</option>
          </optgroup>
        </Select>
      </Field>
    );
  },
};

/** A select that cannot be changed right now, for a choice fixed by the flight's state. */
export const Disabled: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="s-site">Launch site</FieldLabel>
      <Select id="s-site" value="pad" disabled onChange={() => {}}>
        <option value="pad">KSC Launch Pad</option>
        <option value="runway">KSC Runway</option>
      </Select>
      <FieldHint>Fixed once the vessel is off the pad.</FieldHint>
    </Field>
  ),
};

/** A narrow select inline beside its label and the value it drives. */
export const InRow: Story = {
  render: function Render() {
    const [rate, setRate] = useState("10");
    return (
      <FieldRow>
        <FieldLabel htmlFor="s-warp">Warp</FieldLabel>
        <Select
          id="s-warp"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={{ width: 96 }}
        >
          {["1", "5", "10", "50", "100", "1000"].map((r) => (
            <option key={r} value={r}>
              {`${r}x`}
            </option>
          ))}
        </Select>
        <Text level="muted" size="sm">
          {`${rate}x time`}
        </Text>
      </FieldRow>
    );
  },
};
