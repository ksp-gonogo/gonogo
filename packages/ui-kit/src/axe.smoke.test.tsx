import { render } from "@ksp-gonogo/test-utils";
import { describe, it } from "vitest";
import { ActionButton } from "./ActionButton";
import { Badge } from "./Badge";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Grid } from "./Grid";
import { Panel, PanelTitle } from "./Panel";
import { ProgressBar } from "./ProgressBar";
import { Row, RowName } from "./Row";
import { Section, SectionTitle } from "./Section";
import { StatusIndicator } from "./StatusIndicator";
import { ScienceExperimentRow } from "./science/ScienceExperimentRow";
import { axe } from "./test/axe";
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Badge has no axe violations across tones", async () => {
    const { container } = render(
      <>
        <Badge tone="neutral">neutral</Badge>
        <Badge tone="go">go</Badge>
        <Badge tone="nogo">nogo</Badge>
        <Badge tone="warn">warn</Badge>
        <Badge tone="info">info</Badge>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Row has no axe violations", async () => {
    const { container } = render(
      <ul>
        <Row>
          <RowName>Thermometer (Mystery Goo)</RowName>
        </Row>
      </ul>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("EmptyState has no axe violations in either layout", async () => {
    const { container } = render(
      <>
        <EmptyState>No instruments</EmptyState>
        <EmptyState layout="fill">No instruments</EmptyState>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Panel + PanelTitle has no axe violations", async () => {
    const { container } = render(
      <Panel>
        <PanelTitle>Science Lab</PanelTitle>
      </Panel>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Card has no axe violations", async () => {
    const { container } = render(<Card>Kerbin Explorer I</Card>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("ProgressBar has no axe violations", async () => {
    const { container } = render(
      <ProgressBar value={64} ariaLabel="Biome coverage — Kerbin" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Section + SectionTitle has no axe violations", async () => {
    const { container } = render(
      <Section>
        <SectionTitle>Coverage</SectionTitle>
        <span>Altimetry (Hi) — 42%</span>
      </Section>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Grid has no axe violations", async () => {
    const { container } = render(
      <Grid cols="120px 1fr 60px">
        <span>Altimetry (Hi)</span>
        <ProgressBar value={64} ariaLabel="Altimetry coverage" />
        <span>64%</span>
      </Grid>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
