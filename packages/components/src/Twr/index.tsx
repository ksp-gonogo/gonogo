import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { EmptyState, Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

type TwrConfig = Record<string, never>;

type Tone = "ok" | "warn" | "lost";

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

// TWR < 1 means the vessel can't accelerate against gravity — qualitatively
// different from "low TWR but climbing". Highlight that boundary visibly.
function toneFor(twr: number): Tone {
  if (twr < 1) return "lost";
  if (twr < 1.5) return "warn";
  return "ok";
}

function TwrComponent(_props: Readonly<ComponentProps<TwrConfig>>) {
  const twr = useDataValue<number>("data", "dv.currentTWR");

  if (twr === undefined || !Number.isFinite(twr)) {
    return (
      <Panel>
        <PanelTitle>TWR</PanelTitle>
        <EmptyState>No engine data</EmptyState>
      </Panel>
    );
  }

  const tone = toneFor(twr);

  return (
    <Panel>
      <PanelTitle>TWR</PanelTitle>
      <PanelSubtitle>Current stage</PanelSubtitle>
      <Body>
        <Readout role="status" aria-live="polite" $tone={tone}>
          {twr.toFixed(2)}
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

const Readout = styled.div<{ $tone: Tone }>`
  font-size: 32px;
  letter-spacing: 0.04em;
  color: ${({ $tone }) => TONE_COLOR[$tone]};
`;

registerComponent<TwrConfig>({
  id: "twr",
  name: "TWR",
  description:
    "Thrust-to-weight ratio of the active stage. Tinted red below 1 (can't lift off), amber 1–1.5, green above.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  component: TwrComponent,
  dataRequirements: ["dv.currentTWR"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { TwrComponent };
