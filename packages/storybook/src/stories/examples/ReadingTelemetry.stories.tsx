import type { Meta, StoryObj } from "@storybook/react-vite";
import { FlightReadout } from "../../examples/FlightReadout";
import { FixtureStream } from "../../FixtureStream";
import { withGonogoFrame } from "../../frame";

const FLIGHT = {
  latitude: -0.1,
  longitude: -74.6,
  altitudeAsl: 71_420,
  altitudeTerrain: 71_420,
  verticalSpeed: 212.4,
  surfaceSpeed: 1_604.2,
  orbitalSpeed: 1_780.9,
  gForce: 1.4,
  dynamicPressureKPa: 0.8,
  mach: 5.1,
  atmDensity: 0.00012,
  externalTemperature: 238,
  atmosphericTemperature: 231,
};

interface ReadingTelemetryArgs {
  /** What reaches the stream: a flight, a confirmed absence, or nothing. */
  payload: "flight" | "absent" | "nothing";
  /** Drop the link after the payload lands. */
  stopsArriving: boolean;
}

function Scene({ payload, stopsArriving }: ReadingTelemetryArgs) {
  const emits =
    payload === "nothing"
      ? []
      : [
          {
            topic: "vessel.flight",
            payload: payload === "flight" ? FLIGHT : null,
          },
        ];
  return (
    <FixtureStream
      carried={["vessel.flight"]}
      emits={emits}
      stopsArriving={stopsArriving}
    >
      <FlightReadout />
    </FixtureStream>
  );
}

const meta = {
  title: "Examples/Reading telemetry",
  component: Scene,
  decorators: [withGonogoFrame],
  argTypes: {
    payload: {
      control: "inline-radio",
      options: ["flight", "absent", "nothing"],
    },
  },
} satisfies Meta<typeof Scene>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figures arriving: each field is an observation. */
export const Live: Story = {
  args: { payload: "flight", stopsArriving: false },
};

/** The link dropped after the last figures: each is held and marked so. */
export const Held: Story = {
  args: { payload: "flight", stopsArriving: true },
};

/** The source confirmed there is no flight: each field is absent. */
export const Absent: Story = {
  args: { payload: "absent", stopsArriving: false },
};

/** Nothing has arrived yet: each field is pending. */
export const Pending: Story = {
  args: { payload: "nothing", stopsArriving: false },
};
