import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import { ActionButton } from "./ActionButton";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { Panel, PanelTitle } from "./Panel";
import { Row, RowName } from "./Row";
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
});
