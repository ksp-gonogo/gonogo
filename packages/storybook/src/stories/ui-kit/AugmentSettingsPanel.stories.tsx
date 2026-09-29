import type { NamespacedAugmentSettings } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSettingsPanel,
  type AugmentSettingsPanelProps,
  ConfigForm,
  EmptyState,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

/** Two Uplinks bound to Crew Status, each contributing its own block of settings. */
const CREW_STATUS_SETTINGS: NamespacedAugmentSettings[] = [
  {
    augmentId: "kerbalism-crew-meters",
    namespace: "kerbalism-crew-meters",
    fields: [
      {
        key: "showRadiation",
        type: "boolean",
        label: "Show radiation dose",
        default: true,
      },
      {
        key: "showStress",
        type: "boolean",
        label: "Show stress",
        default: false,
      },
      {
        key: "warnAt",
        type: "number",
        label: "Warn at dose (rad)",
        default: 25,
      },
    ],
  },
  {
    augmentId: "portrait-overlay",
    namespace: "portrait-overlay",
    fields: [
      {
        key: "caption",
        type: "text",
        label: "Portrait caption",
        default: "Kerbal X crew",
      },
      {
        key: "hideVeterans",
        type: "boolean",
        label: "Hide veterans' stars",
        default: false,
      },
    ],
  },
];

/** Holds the per-augment values the way a widget's saved config does, so every control works. */
function Editable({
  settings,
  initial,
}: {
  settings: readonly NamespacedAugmentSettings[];
  initial?: AugmentSettingsPanelProps["values"];
}) {
  const [values, setValues] = useState(initial);
  return (
    <ConfigForm>
      <AugmentSettingsPanel
        settings={settings}
        values={values}
        onChange={(namespace, key, value) =>
          setValues((prev) => ({
            ...prev,
            [namespace]: { ...prev?.[namespace], [key]: value },
          }))
        }
      />
    </ConfigForm>
  );
}

const meta = {
  title: "ui-kit/AugmentSettingsPanel",
  component: AugmentSettingsPanel,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    settings: CREW_STATUS_SETTINGS,
    values: undefined,
    onChange: () => {},
  },
} satisfies Meta<typeof AugmentSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing saved yet: each control shows its field's own default. A switch, a number and a text field, all editable. */
export const Defaults: Story = {
  render: (args) => <Editable settings={args.settings} />,
};

/** Values saved on this widget instance override the defaults, per augment. */
export const SavedValues: Story = {
  render: (args) => (
    <Editable
      settings={args.settings}
      initial={{
        "kerbalism-crew-meters": { showStress: true, warnAt: 40 },
        "portrait-overlay": { caption: "Mun lander crew" },
      }}
    />
  ),
};

/** Two augments with an identically named key keep separate values, since each is scoped to its own namespace. */
export const SameKeyTwoAugments: Story = {
  render: () => (
    <Editable
      settings={[
        {
          augmentId: "scansat-overlay",
          namespace: "scansat-overlay",
          fields: [
            {
              key: "enabled",
              type: "boolean",
              label: "SCANsat coverage overlay",
              default: true,
            },
          ],
        },
        {
          augmentId: "biome-overlay",
          namespace: "biome-overlay",
          fields: [
            {
              key: "enabled",
              type: "boolean",
              label: "Biome boundaries overlay",
              default: false,
            },
          ],
        },
      ]}
    />
  ),
};

/** A field with no label falls back to its key, which is all the operator sees. */
export const UnlabelledField: Story = {
  render: () => (
    <Editable
      settings={[
        {
          augmentId: "kerbalism-crew-meters",
          namespace: "kerbalism-crew-meters",
          fields: [{ key: "showRadiation", type: "boolean", default: true }],
        },
      ]}
    />
  ),
};

/** No augment contributes a setting: the panel renders nothing, so the host's own note stands alone. */
export const NoSettings: Story = {
  render: () => (
    <>
      <AugmentSettingsPanel
        settings={[]}
        values={undefined}
        onChange={() => {}}
      />
      <EmptyState>No Uplink adds settings to this widget</EmptyState>
    </>
  ),
};
