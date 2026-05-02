import type { ComponentProps } from "@gonogo/core";
import { formatDistance, registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

type SemiMajorAxisConfig = Record<string, never>;

function SemiMajorAxisComponent(
  _props: Readonly<ComponentProps<SemiMajorAxisConfig>>,
) {
  const sma = useDataValue<number>("data", "o.sma");
  const referenceBody = useDataValue<string>("data", "o.referenceBody");

  if (sma === undefined || !Number.isFinite(sma)) {
    return (
      <Panel>
        <PanelTitle>SMA</PanelTitle>
        <EmptyState>No orbit data</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>SMA</PanelTitle>
      <PanelSubtitle>
        Semi-major axis{referenceBody ? ` · ${referenceBody}` : ""}
      </PanelSubtitle>
      <Body>
        <Readout role="status" aria-live="polite">
          {formatDistance(sma)}
        </Readout>
      </Body>
    </Panel>
  );
}

const Body = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
`;

const Readout = styled.div`
  font-size: 28px;
  letter-spacing: 0.04em;
  color: var(--color-text-primary);
`;

registerComponent<SemiMajorAxisConfig>({
  id: "semi-major-axis",
  name: "Semi-major axis",
  description:
    "Semi-major axis of the current orbit (distance from the body centre, averaged across the ellipse). Determines orbital period and total energy.",
  tags: ["telemetry", "orbit"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  component: SemiMajorAxisComponent,
  dataRequirements: ["o.sma", "o.referenceBody"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { SemiMajorAxisComponent };
