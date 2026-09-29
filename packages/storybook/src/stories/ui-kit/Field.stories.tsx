import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  Textarea,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/Field",
  component: Field,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several fields stacked in a form: each keeps its label directly over its own control. */
export const Stacked: Story = {
  render: function Render() {
    const [name, setName] = useState("Kerbal X");
    const [body, setBody] = useState("mun");
    const [apo, setApo] = useState("80000");
    return (
      <ConfigForm>
        <Field>
          <FieldLabel htmlFor="f-name">Vessel name</FieldLabel>
          <Input
            id="f-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="f-body">Target body</FieldLabel>
          <Select
            id="f-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          >
            <option value="kerbin">Kerbin</option>
            <option value="mun">Mun</option>
            <option value="minmus">Minmus</option>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-apo">Target apoapsis (m)</FieldLabel>
          <Input
            id="f-apo"
            type="number"
            value={apo}
            onChange={(e) => setApo(e.target.value)}
          />
        </Field>
      </ConfigForm>
    );
  },
};

/** A text input with a hint underneath carrying the current reading for comparison. */
export const WithHint: Story = {
  render: function Render() {
    const [periapsis, setPeriapsis] = useState("72000");
    return (
      <Field>
        <FieldLabel htmlFor="f-pe">Target periapsis (m)</FieldLabel>
        <Input
          id="f-pe"
          type="number"
          value={periapsis}
          onChange={(e) => setPeriapsis(e.target.value)}
        />
        <FieldHint>
          Currently <Unit value={live("m", 68_412)} />
        </FieldHint>
      </Field>
    );
  },
};

/** A multi-line control in a field: the label sits over a resizable textarea. */
export const Multiline: Story = {
  render: function Render() {
    const [notes, setNotes] = useState(
      "Jebediah Kerman reports a wobble at max Q. Struts added to stage 2.",
    );
    return (
      <Field>
        <FieldLabel htmlFor="f-notes">Flight notes</FieldLabel>
        <Textarea
          id="f-notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    );
  },
};

/** A field whose control is disabled: the label stays readable. */
export const Disabled: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="f-locked">Launch site</FieldLabel>
      <Input id="f-locked" value="KSC Launch Pad" disabled readOnly />
      <FieldHint>Locked once the vessel has left the pad.</FieldHint>
    </Field>
  ),
};
