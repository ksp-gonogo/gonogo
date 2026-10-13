import {
  DataKeyPicker,
  type DataKeyPickerProps,
  Field,
  FieldHint,
  FieldLabel,
  type KeyOption,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360, minHeight: 380 }}>{children}</div>;
}

/** Real Topic fields, keyed `<topic>.<field>` and grouped by Topic, as the app's own pickers offer them. */
const KEYS: KeyOption[] = [
  {
    key: "vessel.flight.altitudeAsl",
    label: "Altitude ASL",
    group: "vessel.flight",
    unit: "m",
  },
  {
    key: "vessel.flight.surfaceSpeed",
    label: "Surface speed",
    group: "vessel.flight",
    unit: "m/s",
  },
  {
    key: "vessel.flight.verticalSpeed",
    label: "Vertical speed",
    group: "vessel.flight",
    unit: "m/s",
  },
  {
    key: "vessel.surface.heightFromTerrain",
    label: "Height from terrain",
    group: "vessel.surface",
    unit: "m",
  },
  { key: "vessel.orbit.sma", label: "Sma", group: "vessel.orbit", unit: "m" },
  {
    key: "vessel.orbit.timeToAp",
    label: "Time to ap",
    group: "vessel.orbit",
    unit: "s",
  },
  {
    key: "vessel.orbit.timeToPe",
    label: "Time to pe",
    group: "vessel.orbit",
    unit: "s",
  },
  { key: "vessel.orbit.inc", label: "Inc", group: "vessel.orbit", unit: "°" },
  {
    key: "vessel.propulsion.currentThrust",
    label: "Current thrust",
    group: "vessel.propulsion",
    unit: "kN",
  },
  {
    key: "vessel.propulsion.totalMass",
    label: "Total mass",
    group: "vessel.propulsion",
    unit: "t",
  },
];

/** A DataKeyPicker holding its own key, so picking and clearing work. */
function Controlled({
  initial,
  hint = true,
  ...rest
}: Omit<DataKeyPickerProps, "value" | "onChange"> & {
  initial: string | null;
  hint?: boolean;
}) {
  const [key, setKey] = useState<string | null>(initial);
  return (
    <Field>
      <FieldLabel htmlFor="dkp-input">Plotted value</FieldLabel>
      <DataKeyPicker {...rest} id="dkp-input" value={key} onChange={setKey} />
      {hint && <FieldHint>{key ?? "Nothing picked"}</FieldHint>}
    </Field>
  );
}

const meta = {
  title: "ui-kit/DataKeyPicker",
  component: DataKeyPicker,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { keys: KEYS, value: null, onChange: () => {} },
} satisfies Meta<typeof DataKeyPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opened on focus: keys grouped by domain with their units, the committed one marked, and typing narrows the list. */
export const Open: Story = {
  render: function Render() {
    useEffect(() => {
      document.getElementById("dkp-input")?.focus();
    }, []);
    return (
      <Controlled
        keys={KEYS}
        initial="vessel.orbit.sma"
        subjectNoun="plotted value"
      />
    );
  },
};

/** A key already picked: the input shows its label, and the clear control empties it. */
export const Picked: Story = {
  render: () => (
    <Controlled
      keys={KEYS}
      initial="vessel.propulsion.totalMass"
      clearable
      subjectNoun="plotted value"
    />
  ),
};

/** Nothing picked yet: the placeholder invites a search. */
export const Empty: Story = {
  render: () => (
    <Controlled keys={KEYS} initial={null} placeholder="Search telemetry..." />
  ),
};

/** A saved key that is no longer on offer: marked in the no-go colour with a note, never passed off as a valid pick. */
export const Retired: Story = {
  render: () => (
    <Controlled
      keys={KEYS}
      initial="vessel.flight.altitude"
      clearable
      subjectNoun="plotted value"
      hint={false}
    />
  ),
};

/** The catalogue has not arrived: a saved key shows as typed and is not judged retired. */
export const CatalogueLoading: Story = {
  render: () => (
    <Controlled keys={[]} initial="vessel.orbit.sma" hint={false} />
  ),
};
