import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, it } from "vitest";
import { ActionButton } from "./ActionButton";
import { AugmentSettingsPanel } from "./AugmentSettingsPanel";
import type { NamespacedAugmentSettings } from "./augments";
import { Badge } from "./Badge";
import { Card } from "./Card";
import { Dial } from "./Dial";
import { EmptyState } from "./EmptyState";
import { Grid } from "./Grid";
import { Panel, PanelTitle } from "./Panel";
import { ProgressBar } from "./ProgressBar";
import { Row, RowName } from "./Row";
import { Section, SectionTitle } from "./Section";
import { StatusIndicator } from "./StatusIndicator";
import { ScienceExperimentRow } from "./science/ScienceExperimentRow";
import { Tabs } from "./Tabs";
import { Tape } from "./Tape";
import { WidgetHeader } from "./WidgetHeader";

describe("a11y smoke (jest-axe)", () => {
  it("ActionButton (both tones) has no axe violations", async () => {
    const { container } = render(
      <>
        <ActionButton>Deploy</ActionButton>
        <ActionButton tone="go">Confirm transmit</ActionButton>
        <ActionButton disabled aria-busy="true">
          Arming
        </ActionButton>
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("AugmentSettingsPanel has no axe violations across field types", async () => {
    const settings: NamespacedAugmentSettings[] = [
      {
        augmentId: "example-augment",
        namespace: "example-augment",
        fields: [
          { key: "show", type: "boolean", label: "Show overlay" },
          { key: "label", type: "text", label: "Overlay label" },
          { key: "count", type: "number", label: "Count" },
        ],
      },
    ];
    const { container } = render(
      <AugmentSettingsPanel
        settings={settings}
        values={undefined}
        onChange={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("Badge has no axe violations across severities", async () => {
    const { container } = render(
      <>
        <Badge>decorative</Badge>
        <Badge severity="nominal">nominal</Badge>
        <Badge severity="info">info</Badge>
        <Badge severity="caution">caution</Badge>
        <Badge severity="warning">warning</Badge>
        <Badge severity="critical">critical</Badge>
        <Badge severity="offline">offline</Badge>
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("Row has no axe violations", async () => {
    const { container } = render(
      <ul>
        <Row>
          <RowName>Thermometer (Mystery Goo)</RowName>
        </Row>
      </ul>,
    );
    await expectNoA11yViolations(container);
  });

  it("EmptyState has no axe violations in either layout", async () => {
    const { container } = render(
      <>
        <EmptyState>No instruments</EmptyState>
        <EmptyState layout="fill">No instruments</EmptyState>
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("Panel + PanelTitle has no axe violations", async () => {
    const { container } = render(
      <Panel>
        <PanelTitle>Science Lab</PanelTitle>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });

  it("Panel (scrolling header + ghost) has no axe violations", async () => {
    // The ghost is always in the DOM (opacity gated), so this catches a
    // duplicate heading or a focusable ghost without needing to scroll.
    const { container } = render(
      <Panel panelTitle="Altitude" panelAside={<span>LOW</span>}>
        <p>content</p>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });

  it("Panel (degraded status, ghost dot present) has no axe violations", async () => {
    const { container } = render(
      <Panel panelTitle="Fuel" panelStatus="held-stale">
        <p>content</p>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });

  it("Panel (toolbar, pinned header) has no axe violations", async () => {
    const { container } = render(
      <Panel
        panelTitle="Map"
        panelToolbar={<button type="button">Layers</button>}
      >
        <p>content</p>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });

  it("Panel (floatingHeader) has no axe violations", async () => {
    const { container } = render(
      <Panel panelTitle="Orbit" floatingHeader>
        <p>globe</p>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });

  it("Card has no axe violations", async () => {
    const { container } = render(<Card>Kerbin Explorer I</Card>);
    await expectNoA11yViolations(container);
  });

  it("ProgressBar has no axe violations", async () => {
    const { container } = render(
      <ProgressBar value={64} ariaLabel="Biome coverage: Kerbin" />,
    );
    await expectNoA11yViolations(container);
  });

  it("Tabs has no axe violations, switch mode", async () => {
    const { container } = render(
      <Tabs
        tabs={[
          { id: "one", label: "One", content: <p>panel one</p> },
          { id: "two", label: "Two", content: <p>panel two</p> },
        ]}
        activeId="one"
        onChange={() => undefined}
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("Tape has no axe violations (with zones, markers, ground line)", async () => {
    const { container } = render(
      <Tape
        value={1200}
        min={0}
        max={5000}
        unit="m"
        tickStep={1000}
        groundLine={0}
        zones={[{ from: 400, to: 900, label: "ignition" }]}
        markers={[{ value: 150, label: "gear" }]}
        ariaLabel="Altitude above terrain"
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("Dial has no axe violations (compass with zones + ticks)", async () => {
    const { container } = render(
      <Dial
        value={135}
        min={0}
        max={360}
        wrap
        unit="°"
        ticks={[
          { value: 0, label: "N" },
          { value: 90, label: "E" },
          { value: 180, label: "S" },
          { value: 270, label: "W" },
        ]}
        zones={[{ from: 60, to: 120, color: "var(--color-status-warning-fg)" }]}
        ariaLabel="Slope fall direction"
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("StatusIndicator has no axe violations across tones, live or not", async () => {
    const { container } = render(
      <>
        <StatusIndicator tone="go">Connected</StatusIndicator>
        <StatusIndicator tone="nogo" live>
          Disconnected
        </StatusIndicator>
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("WidgetHeader has no axe violations", async () => {
    const { container } = render(
      <WidgetHeader
        title="Mission clock"
        actions={
          <button type="button" aria-label="reset clock">
            reset
          </button>
        }
      />,
    );
    await expectNoA11yViolations(container);
  });

  it("Section + SectionTitle has no axe violations", async () => {
    const { container } = render(
      <Section>
        <SectionTitle>Coverage</SectionTitle>
        <span>Altimetry (Hi): 42%</span>
      </Section>,
    );
    await expectNoA11yViolations(container);
  });

  it("Grid has no axe violations", async () => {
    const { container } = render(
      <Grid cols="120px 1fr 60px">
        <span>Altimetry (Hi)</span>
        <ProgressBar value={64} ariaLabel="Altimetry coverage" />
        <span>64%</span>
      </Grid>,
    );
    await expectNoA11yViolations(container);
  });

  it("ScienceExperimentRow has no axe violations across instrument states", async () => {
    const { container } = render(
      <ul>
        <ScienceExperimentRow
          instrument={{
            partId: "1",
            partTitle: "Mystery Goo",
            expId: "mysteryGoo",
            deployed: false,
            hasData: false,
            rerunnable: true,
            inoperable: false,
          }}
        />
        <ScienceExperimentRow
          instrument={{
            partId: "2",
            partTitle: "Thermometer",
            expId: "temperatureScan",
            deployed: true,
            hasData: true,
            rerunnable: false,
            inoperable: false,
          }}
        />
        <ScienceExperimentRow
          instrument={{
            partId: "3",
            partTitle: "Burned Sensor",
            expId: "x",
            deployed: false,
            hasData: false,
            rerunnable: false,
            inoperable: true,
          }}
        />
      </ul>,
    );
    await expectNoA11yViolations(container);
  });
});
