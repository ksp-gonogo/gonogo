import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  ModelledAlongside,
  type ModelledQuantityAlongsideProps,
  ReckonedUnit,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 380 }}>{children}</div>;
}

/** A labelled readout line, the observation first and anything modelled after it. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "9rem 1fr",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** An observation whose model has carried it past the last packet received. */
function reckoned<U extends string>(
  unit: U,
  observed: number,
  modelled: number,
  beyondReceived = true,
): Reading<Value<U>> {
  return {
    state: "observed",
    value: value(unit, observed),
    atUt: value("ut", 42_000),
    reckoning: {
      status: "available",
      modelled: value(unit, modelled),
      atUt: value("ut", 42_240),
      beyondReceived,
      basis: "kepler-propagation",
    },
  };
}

/** The quantity form of the overload, which the stories' args drive. */
const QuantityAlongside = ModelledAlongside as (
  props: ModelledQuantityAlongsideProps<string>,
) => ReactNode;

const meta = {
  title: "ui-kit/ModelledAlongside",
  component: QuantityAlongside,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { observed: value("m", 71_420), modelled: value("m", 74_900) },
} satisfies Meta<typeof QuantityAlongside>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A Mun transfer readout under signal delay: each observation with the model's figure for now beside it, marked modelled. */
export const UnderSignalDelay: Story = {
  render: () => (
    <Stack>
      <Line label="Altitude">
        <ReckonedUnit value={reckoned("m", 71_420, 74_900)} />
      </Line>
      <Line label="Orbital speed">
        <ReckonedUnit value={reckoned("m/s", 2_281, 2_274)} />
      </Line>
      <Line label="Mun phase angle">
        <ReckonedUnit value={reckoned("°", 40, 52)} />
      </Line>
      <Line label="Periapsis">
        <ReckonedUnit value={reckoned("m", 14_200, 14_200)} />
      </Line>
    </Stack>
  ),
};

/** Two quantities that read apart: the modelled one is drawn through Unit beside the observation. */
export const Apart: Story = {
  render: (args) => (
    <Line label="Altitude">
      <Unit value={args.observed} />
      <ModelledAlongside {...args} />
    </Line>
  ),
};

/** A model that agrees with the observation at the precision drawn is not repeated. */
export const Agrees: Story = {
  args: { observed: value("m", 71_420), modelled: value("m", 71_420.2) },
  render: (args) => (
    <Line label="Altitude">
      <Unit value={args.observed} />
      <ModelledAlongside {...args} />
    </Line>
  ),
};

/** A model that differs only in the last place drawn is still drawn. */
export const LastPlace: Story = {
  args: { observed: value("°", 40), modelled: value("°", 40.04) },
  render: (args) => (
    <Line label="Inclination">
      <Unit value={args.observed} />
      <ModelledAlongside {...args} />
    </Line>
  ),
};

/** A figure that is not a quantity, compared and written by the caller's own write. */
export const WrittenFigure: Story = {
  render: () => (
    <Stack>
      <Line label="Crew aboard">
        3 kerbals
        <ModelledAlongside
          observed={3}
          modelled={2}
          write={(n: number) => `${n} kerbals`}
        />
      </Line>
      <Line label="Stage">
        S4
        <ModelledAlongside
          observed="S4"
          modelled="S3"
          write={(stage: string) => stage}
        />
      </Line>
    </Stack>
  ),
};

/** Where the model stays at the received edge, or the reading is held, only the observation is drawn. */
export const NothingModelled: Story = {
  render: () => (
    <Stack>
      <Line label="At received edge">
        <ReckonedUnit value={reckoned("m", 71_420, 74_900, false)} />
      </Line>
      <Line label="Held">
        <ReckonedUnit value={held("m", 71_420)} />
      </Line>
      <Line label="No model">
        <Unit value={value("m", 71_420)} />
        <ModelledAlongside observed={value("m", 71_420)} modelled={null} />
      </Line>
    </Stack>
  ),
};
