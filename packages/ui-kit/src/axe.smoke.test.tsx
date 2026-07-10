import { render } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import { describe, it } from "vitest";
import { ActionButton } from "./ActionButton";
import { Badge } from "./Badge";
import { defaultDarkTheme } from "./defaultDarkTheme";
import { EmptyState } from "./EmptyState";
import { Panel, PanelTitle } from "./Panel";
import { Row, RowName } from "./Row";
import { ScienceExperimentRow } from "./science/ScienceExperimentRow";
import { axe } from "./test/axe";

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

  it("ScienceExperimentRow has no axe violations across instrument states", async () => {
    const { container } = render(
      <ThemeProvider theme={defaultDarkTheme}>
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
        </ul>
      </ThemeProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
