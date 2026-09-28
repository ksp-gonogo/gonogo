import {
  Badge,
  Button,
  Meter,
  MeterStack,
  Panel,
  PanelStatusStoreProvider,
  Row,
  Section,
  Stat,
  StatStrip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";
import { held, live, pending } from "../../readings";

/**
 * A dashboard tile: a fixed box, since a panel fills whatever it is given, and
 * the status store the dashboard mounts per tile, which the header summary and
 * its collapsed dots read.
 */
function Tile({ children }: { children: ReactNode }) {
  return (
    <PanelStatusStoreProvider>
      <div style={{ width: 520, height: 420 }}>{children}</div>
    </PanelStatusStoreProvider>
  );
}

const meta = {
  title: "ui-kit/Panel",
  component: Panel,
  decorators: [
    (Story) => (
      <Tile>
        <Story />
      </Tile>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

const FLIGHT = (
  <Section key="flight" title="Flight">
    <StatStrip>
      <Stat label="Altitude">
        <Unit value={live("m", 71_240)} />
      </Stat>
      <Stat label="Surface speed">
        <Unit value={live("m/s", 1_842)} />
      </Stat>
      <Stat label="Apoapsis" tone="go">
        <Unit value={live("m", 82_400)} />
      </Stat>
    </StatStrip>
  </Section>
);

const PROPELLANT = (
  <Section key="propellant" title="Propellant">
    <MeterStack>
      <Meter
        label="Liquid fuel"
        value={live("units", 1_260)}
        capacity={live("units", 3_600)}
      />
      <Meter
        label="Oxidizer"
        value={live("units", 1_540)}
        capacity={live("units", 4_400)}
      />
      <Meter
        label="Electric charge"
        value={live("units", 180)}
        capacity={live("units", 400)}
        tone="warn"
      />
    </MeterStack>
  </Section>
);

const CREW = (
  <Section key="crew" title="Crew">
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      <Row>
        <Row.Name>Jebediah Kerman</Row.Name>
        <Badge tone="go">Pilot</Badge>
      </Row>
      <Row>
        <Row.Name>Bill Kerman</Row.Name>
        <Badge tone="go">Engineer</Badge>
      </Row>
      <Row>
        <Row.Name>Bob Kerman</Row.Name>
        <Badge tone="caution">Stressed</Badge>
      </Row>
    </ul>
  </Section>
);

/** A titled tile with header badges and three sections flowing into columns. */
export const Sections: Story = {
  args: {
    panelTitle: "Kerbal X",
    compactTitle: ["KX"],
    panelBadges: [
      { id: "situation", label: "Sub-orbital", tone: "info" },
      { id: "stage", label: "Stage 2", tone: "neutral" },
    ],
    sections: [FLIGHT, PROPELLANT, CREW],
  },
};

/** More rows than the tile holds: the body scrolls under a pinned header, with a glow at the edge that has more. */
export const ScrollingBody: Story = {
  args: {
    panelTitle: "Event log",
    sections: (
      <Section title="Mission events">
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {[
            ["T+00:00", "Liftoff from KSC launch pad"],
            ["T+00:12", "Tower cleared"],
            ["T+00:48", "Gravity turn begun"],
            ["T+01:10", "Max Q"],
            ["T+01:32", "Booster separation"],
            ["T+02:05", "Fairing jettison"],
            ["T+02:40", "Stage 2 ignition"],
            ["T+03:18", "Apoapsis above 80 km"],
            ["T+04:02", "Main engine cutoff"],
            ["T+05:30", "Coasting to apoapsis"],
            ["T+09:44", "Circularisation burn"],
            ["T+10:31", "Orbit achieved: 82 km by 80 km"],
            ["T+12:00", "Solar panels deployed"],
            ["T+14:15", "Antenna extended, link to KSC"],
          ].map(([at, text]) => (
            <Row key={at}>
              <Row.Name>{text}</Row.Name>
              <span>{at}</span>
            </Row>
          ))}
        </ul>
      </Section>
    ),
  },
};

/** A narrow tile: the sections stack in one column and the header aside folds to its status dots. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 240, height: 420 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    panelTitle: "Mun Lander Descent",
    compactTitle: ["Mun Lander", "Lander"],
    panelBadges: [
      { id: "fuel", label: "Low fuel", tone: "warn" },
      { id: "radar", label: "Radar lock", tone: "go" },
    ],
    sections: [FLIGHT, PROPELLANT],
  },
};

/** The stream went quiet: the header carries the stream status and the figures draw held. */
export const StreamHeld: Story = {
  args: {
    panelTitle: "Kerbal X",
    panelStatus: "held",
    sections: (
      <Section title="Flight">
        <StatStrip>
          <Stat label="Altitude">
            <Unit value={held("m", 71_240)} />
          </Stat>
          <Stat label="Surface speed">
            <Unit value={held("m/s", 1_842)} />
          </Stat>
          <Stat label="Periapsis">
            <Unit value={pending<"m">()} />
          </Stat>
        </StatStrip>
      </Section>
    ),
  },
};

/** A toolbar row under the header and a pinned footer that never scrolls away. */
export const ToolbarAndFooter: Story = {
  args: {
    panelTitle: "Ship systems",
    panelToolbar: (
      <>
        <Button variant="ghost" type="button">
          Power
        </Button>
        <Button variant="ghost" type="button">
          Thermal
        </Button>
        <Button variant="ghost" type="button">
          Life support
        </Button>
      </>
    ),
    sections: [PROPELLANT, CREW],
    panelFooter: (
      <Meter
        layout="row"
        label="Power budget"
        value={live("ratio", 0.72)}
        tone="go"
      />
    ),
  },
};

/** A sidebar beside the body, scrolling on its own. */
export const WithSidebar: Story = {
  args: {
    panelTitle: "Kerbin orbit",
    sections: FLIGHT,
    panelSidebar: (
      <Section title="Targets">
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          <Row>
            <Row.Name>Mun</Row.Name>
          </Row>
          <Row>
            <Row.Name>Minmus</Row.Name>
          </Row>
          <Row>
            <Row.Name>KSS Station</Row.Name>
          </Row>
        </ul>
      </Section>
    ),
    sidebarSize: "10rem",
  },
};
