import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  FieldHint,
  kspCalendar,
  MissionDate,
  MissionDateField,
  type MissionDateFieldProps,
  Text,
  utOfParts,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 460 }}>{children}</div>;
}

const IGNITION_UT = utOfParts({
  year: 3,
  day: 46,
  hour: 3,
  minute: 25,
  second: 12,
});

/** One sidereal orbit of the Mun, in seconds. */
const MUN_ORBIT_S = 138_984;

/** A MissionDateField holding its own instant, so typing and nudging both move it. */
function Controlled({
  initial,
  ...rest
}: Omit<MissionDateFieldProps, "value" | "onChange"> & {
  initial: number | null;
}) {
  const [ut, setUt] = useState<number | null>(initial);
  return (
    <ConfigForm>
      <MissionDateField {...rest} value={ut} onChange={setUt} />
      <FieldHint>
        {ut === null ? (
          "Nothing committed yet"
        ) : (
          <>
            Committed <MissionDate value={value("ut", ut)} />
          </>
        )}
      </FieldHint>
    </ConfigForm>
  );
}

const meta = {
  title: "ui-kit/MissionDateField",
  component: MissionDateField,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { label: "Ignition", value: IGNITION_UT, onChange: () => {} },
} satisfies Meta<typeof MissionDateField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An ignition instant split into calendar fields with nudge steps; editing any field or step moves the committed instant. */
export const Ignition: Story = {
  render: (args) => <Controlled label={args.label} initial={IGNITION_UT} />,
};

/** No instant stated: the fields come up empty with the null token and the nudges are disabled until one is typed. */
export const Unset: Story = {
  render: () => <Controlled label="Plan end" initial={null} />,
};

/** Custom steps sized to the task: a quarter of a Mun orbit and a whole one, either way. */
export const OrbitSteps: Story = {
  render: () => (
    <Controlled
      label="Mun encounter"
      initial={IGNITION_UT}
      steps={[MUN_ORBIT_S / 4, MUN_ORBIT_S]}
    />
  ),
};

/** An empty step list drops the nudge row, for a host with its own coarse control beside the fields. */
export const NoSteps: Story = {
  render: () => <Controlled label="Alarm" initial={IGNITION_UT} steps={[]} />,
};

/** Two fields on one panel, each named for its own role so a screen reader can tell them apart. */
export const Window: Story = {
  render: () => (
    <ConfigForm>
      <Text tone="muted" size="sm">
        Transfer window, Kerbin to Duna
      </Text>
      <Controlled label="Window opens" initial={IGNITION_UT} steps={[]} />
      <Controlled
        label="Window closes"
        initial={IGNITION_UT + 3 * kspCalendar().day + 2 * kspCalendar().hour}
        steps={[]}
      />
    </ConfigForm>
  ),
};

/** Disabled: every field and step is inert, for an instant that is fixed once the burn is armed. */
export const Disabled: Story = {
  args: { label: "Ignition", value: IGNITION_UT, disabled: true },
};
