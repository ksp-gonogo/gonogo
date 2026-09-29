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

const KEYS: KeyOption[] = [
  {
    key: "v.altitude",
    label: "Altitude (sea level)",
    group: "Flight",
    unit: "m",
  },
  {
    key: "v.heightFromTerrain",
    label: "Radar altitude",
    group: "Flight",
    unit: "m",
  },
  {
    key: "v.surfaceSpeed",
    label: "Surface speed",
    group: "Flight",
    unit: "m/s",
  },
  {
    key: "v.verticalSpeed",
    label: "Vertical speed",
    group: "Flight",
    unit: "m/s",
  },
  { key: "o.ApA", label: "Apoapsis", group: "Orbit", unit: "m" },
  { key: "o.PeA", label: "Periapsis", group: "Orbit", unit: "m" },
  { key: "o.inclination", label: "Inclination", group: "Orbit", unit: "°" },
  {
    key: "r.LiquidFuel",
    label: "Liquid fuel",
    group: "Resources",
    unit: "units",
  },
  { key: "r.Oxidizer", label: "Oxidizer", group: "Resources", unit: "units" },
  {
    key: "r.ElectricCharge",
    label: "Electric charge",
    group: "Resources",
    unit: "EC",
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
      <Controlled keys={KEYS} initial="o.ApA" subjectNoun="plotted value" />
    );
  },
};

/** A key already picked: the input shows its label, and the clear control empties it. */
export const Picked: Story = {
  render: () => (
    <Controlled
      keys={KEYS}
      initial="r.LiquidFuel"
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
      initial="survey.coverage.Mun.biome"
      clearable
      subjectNoun="plotted value"
      hint={false}
    />
  ),
};

/** The catalogue has not arrived: a saved key shows as typed and is not judged retired. */
export const CatalogueLoading: Story = {
  render: () => <Controlled keys={[]} initial="o.ApA" hint={false} />,
};
