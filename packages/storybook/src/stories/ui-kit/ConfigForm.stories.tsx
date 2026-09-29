import {
  Button,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  FormActions,
  Input,
  PrimaryButton,
  Select,
  Switch,
  Textarea,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/ConfigForm",
  component: ConfigForm,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof ConfigForm>;

export default meta;
type Story = StoryObj<typeof meta>;

function AlarmForm({ boxed }: { boxed?: boolean }) {
  const [vessel, setVessel] = useState("kerbal-x");
  const [name, setName] = useState("Mun circularisation");
  const [lead, setLead] = useState("120");
  const [warp, setWarp] = useState(true);
  const [notes, setNotes] = useState(
    "Jebediah on the burn, Bill on the tanks.",
  );

  return (
    <ConfigForm $boxed={boxed}>
      <Field>
        <FieldLabel htmlFor="alarm-vessel">Vessel</FieldLabel>
        <Select
          id="alarm-vessel"
          value={vessel}
          onChange={(e) => setVessel(e.target.value)}
        >
          <option value="kerbal-x">Kerbal X</option>
          <option value="mun-lander">Mun Lander II</option>
          <option value="relay-1">KerbNet Relay 1</option>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="alarm-name">Alarm name</FieldLabel>
        <Input
          id="alarm-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="alarm-lead">Lead time (s)</FieldLabel>
        <Input
          id="alarm-lead"
          type="number"
          min={0}
          value={lead}
          onChange={(e) => setLead(e.target.value)}
        />
        <FieldHint>How long before the node the alarm fires.</FieldHint>
      </Field>
      <FieldRow>
        <Switch
          checked={warp}
          onChange={setWarp}
          label="Drop out of time warp"
        />
      </FieldRow>
      <Field>
        <FieldLabel htmlFor="alarm-notes">Notes</FieldLabel>
        <Textarea
          id="alarm-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <FormActions>
        <Button type="button" onClick={() => {}}>
          Cancel
        </Button>
        <PrimaryButton type="button" onClick={() => {}}>
          Save alarm
        </PrimaryButton>
      </FormActions>
    </ConfigForm>
  );
}

/** A boxed form on its own panel surface: fields, a switch row and the save actions, all editable. */
export const Boxed: Story = {
  render: () => <AlarmForm boxed />,
};

/** The unboxed body a settings section uses: no surface of its own and the looser field gap. */
export const Unboxed: Story = {
  render: () => <AlarmForm />,
};

/** A short data-source form: two fields and a hint, the shape most settings panes take. */
export const Connection: Story = {
  render: function Render() {
    const [host, setHost] = useState("steamdeck.local");
    const [port, setPort] = useState("8090");
    return (
      <ConfigForm $boxed>
        <Field>
          <FieldLabel htmlFor="conn-host">Host</FieldLabel>
          <Input
            id="conn-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="conn-port">Port</FieldLabel>
          <Input
            id="conn-port"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          <FieldHint>
            The telemetry stream listens on 8090 unless changed.
          </FieldHint>
        </Field>
        <FormActions>
          <PrimaryButton type="button" onClick={() => {}}>
            Connect
          </PrimaryButton>
        </FormActions>
      </ConfigForm>
    );
  },
};
