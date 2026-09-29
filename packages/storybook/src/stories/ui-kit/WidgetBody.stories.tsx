import type { ComponentDefinition, TinyMode } from "@ksp-gonogo/sitrep-sdk";
import {
  Panel,
  Row,
  RowName,
  Section,
  Unit,
  WidgetBody,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live } from "../../readings";

const ALTITUDE = live("m", 12_480);
const VERTICAL_SPEED = live("m/s", -4.2);
const SURFACE_SPEED = held("m/s", 38.6);

/** The widget's own body, drawn whenever its tile is big enough. */
function Descent() {
  return (
    <Panel
      panelTitle="Descent"
      sections={
        <Section>
          <Row as="div">
            <RowName>Altitude</RowName>
            <Unit value={ALTITUDE} />
          </Row>
          <Row as="div">
            <RowName>Vertical speed</RowName>
            <Unit value={VERTICAL_SPEED} />
          </Row>
          <Row as="div">
            <RowName>Surface speed</RowName>
            <Unit value={SURFACE_SPEED} />
          </Row>
        </Section>
      }
    />
  );
}

const DESCENT_TINY: TinyMode = {
  title: "DESCENT",
  useEssentials: () => [
    { label: "ALT", value: ALTITUDE },
    { label: "V/S", value: VERTICAL_SPEED, decimals: 1, tone: "warn" },
  ],
};

const DESCENT: ComponentDefinition = {
  id: "storybook-widgetbody-descent",
  name: "Descent",
  description: "Altitude and speeds on the way down.",
  tags: ["telemetry"],
  component: Descent,
  tiny: DESCENT_TINY,
};

/** The same widget, declaring its body needs a larger tile than the kit's tiny bucket. */
const DESCENT_ROOMY: ComponentDefinition = {
  ...DESCENT,
  id: "storybook-widgetbody-descent-roomy",
  tiny: { ...DESCENT_TINY, bodyMinSize: { w: 10, h: 8 } },
};

/** The dashboard grid's column width, row height and margin, in pixels. */
const COL_PX = 32;
const ROW_PX = 25;
const MARGIN_PX = 8;

/** A box the size of a `w` by `h` grid tile. */
function Tile({
  w,
  h,
  children,
}: {
  w: number;
  h: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: w * COL_PX + (w - 1) * MARGIN_PX,
        height: h * ROW_PX + (h - 1) * MARGIN_PX,
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/WidgetBody",
  component: WidgetBody,
  decorators: [withGonogoFrame],
  args: { def: DESCENT, id: "descent-1", w: 10, h: 8 },
  render: (args) => (
    <Tile w={args.w ?? 10} h={args.h ?? 8}>
      <WidgetBody {...args} />
    </Tile>
  ),
} satisfies Meta<typeof WidgetBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A tile at or above the tiny bucket: the widget's own component draws. */
export const Body: Story = {};

/** A tile in the tiny bucket: the kit's tiny form, the first essential drawn large and the rest as rows under it. */
export const Tiny: Story = {
  args: { w: 4, h: 5 },
};

/** With `bodyMinSize`, a tile that would be normal-sized still shows the tiny form until it reaches that floor. */
export const BelowBodyMinSize: Story = {
  args: { def: DESCENT_ROOMY, w: 8, h: 6 },
};

/** A widget with no tiny mode draws its own body at every size. */
export const NoTinyMode: Story = {
  args: { def: { ...DESCENT, tiny: undefined }, w: 4, h: 3 },
};
