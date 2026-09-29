import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  DataTable,
  type DataTableColumn,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { absent, held, live, pending } from "../../readings";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 560 }}>{children}</div>;
}

interface Vessel {
  name: string;
  body: string;
  situation: string;
  altitude: Reading<Value<"m">>;
  speed: Reading<Value<"m/s">>;
  fuel: Reading<Value<"ratio">>;
}

const FLEET: Vessel[] = [
  {
    name: "Kerbal X",
    body: "Kerbin",
    situation: "Orbiting",
    altitude: live("m", 84_320),
    speed: live("m/s", 2_274),
    fuel: live("ratio", 0.42),
  },
  {
    name: "Mun Lander II",
    body: "Mun",
    situation: "Landed",
    altitude: live("m", 0),
    speed: live("m/s", 0),
    fuel: live("ratio", 0.08),
  },
  {
    name: "Minmus Relay",
    body: "Minmus",
    situation: "Orbiting",
    altitude: held("m", 212_000),
    speed: held("m/s", 126),
    fuel: held("ratio", 0.91),
  },
  {
    name: "Duna Probe",
    body: "Sun",
    situation: "Escaping",
    altitude: pending(),
    speed: pending(),
    fuel: absent(),
  },
];

const FLEET_COLUMNS: DataTableColumn<Vessel>[] = [
  {
    key: "name",
    header: "Vessel",
    rowHeader: true,
    render: (v) => v.name,
    minWidth: "10ch",
  },
  { key: "situation", header: "Situation", render: (v) => v.situation },
  {
    key: "altitude",
    header: "Altitude",
    align: "end",
    width: "11ch",
    value: (v) => v.altitude,
  },
  {
    key: "speed",
    header: "Speed",
    align: "end",
    width: "11ch",
    value: (v) => v.speed,
  },
  {
    key: "fuel",
    header: "Fuel",
    align: "end",
    width: "7ch",
    value: (v) => v.fuel,
  },
];

/** The table typed to its rows, so each story's row callbacks are checked against a Vessel. */
const VesselTable = DataTable<Vessel>;

const meta = {
  title: "ui-kit/DataTable",
  component: VesselTable,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    caption: "Tracked vessels",
    columns: FLEET_COLUMNS,
    rows: FLEET,
    rowKey: (v: Vessel) => v.name,
  },
} satisfies Meta<typeof VesselTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fleet table: numeric columns end-aligned so digits line up, with held, pending and absent figures marked in their cells. */
export const Fleet: Story = {};

/** Rows grouped under a heading per body, each group its own table body. */
export const Sections: Story = {
  args: {
    rows: undefined,
    sections: [
      {
        id: "kerbin",
        title: "Kerbin",
        rows: FLEET.filter((v) => v.body === "Kerbin"),
      },
      { id: "mun", title: "Mun", rows: FLEET.filter((v) => v.body === "Mun") },
      {
        id: "minmus",
        title: "Minmus",
        rows: FLEET.filter((v) => v.body === "Minmus"),
      },
    ],
  },
};

/** A full-width detail row under each vessel, for per-row controls, keeping the columns aligned. */
export const RowDetail: Story = {
  args: {
    rowDetail: (v: Vessel) =>
      v.situation === "Landed" ? (
        <span>
          <Badge severity="caution">Low fuel</Badge> Jebediah Kerman awaiting
          ascent window
        </span>
      ) : null,
  },
};

/** The empty message spans the table under its headers when there is nothing to list. */
export const Empty: Story = {
  args: { rows: [], empty: "No vessels tracked in this save" },
};

interface Crew {
  name: string;
  role: string;
  vessel: string;
  dose: Reading<Value<"ratio">>;
}

const CREW: Crew[] = [
  {
    name: "Jebediah Kerman",
    role: "Pilot",
    vessel: "Kerbal X",
    dose: live("ratio", 0.12),
  },
  {
    name: "Bill Kerman",
    role: "Engineer",
    vessel: "Mun Lander II",
    dose: live("ratio", 0.39),
  },
  {
    name: "Bob Kerman",
    role: "Scientist",
    vessel: "Mun Lander II",
    dose: held("ratio", 0.41),
  },
  {
    name: "Valentina Kerman",
    role: "Pilot",
    vessel: "Minmus Relay",
    dose: pending(),
  },
];

/** A crew roster mixing plain text, a caller-rendered figure and a Unit-drawn reading. */
export const CrewRoster: Story = {
  render: () => (
    <DataTable<Crew>
      caption="Crew roster"
      rowKey={(c) => c.name}
      rows={CREW}
      columns={[
        {
          key: "name",
          header: "Kerbal",
          rowHeader: true,
          render: (c) => c.name,
        },
        { key: "role", header: "Role", render: (c) => c.role },
        { key: "vessel", header: "Vessel", render: (c) => c.vessel },
        {
          key: "dose",
          header: "Dose",
          align: "end",
          width: "8ch",
          render: (c) => <Unit value={c.dose} />,
        },
      ]}
    />
  ),
};
