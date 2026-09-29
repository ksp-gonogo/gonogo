import { EmptyState, Panel, Row, Section } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 360 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/EmptyState",
  component: EmptyState,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { children: "No active vessel" },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A panel with nothing to show: the placeholder fills the body, centred. */
export const FillsAPanel: Story = {
  render: () => (
    <div style={{ height: 240 }}>
      <Panel panelTitle="Target">
        <EmptyState layout="fill">No target selected</EmptyState>
      </Panel>
    </div>
  ),
};

/** Inline, it stands in for the rows of one section and lines up with the section beside it. */
export const InlineInASection: Story = {
  render: () => (
    <div style={{ height: 280 }}>
      <Panel
        panelTitle="Kerbal X"
        sections={[
          <Section key="crew" title="Crew">
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              <Row>
                <Row.Name>Jebediah Kerman</Row.Name>
              </Row>
              <Row>
                <Row.Name>Bill Kerman</Row.Name>
              </Row>
            </ul>
          </Section>,
          <Section key="experiments" title="Experiments">
            <EmptyState>No experiments on board</EmptyState>
          </Section>,
        ]}
        sectionMinWidth="100%"
      />
    </div>
  ),
};

/** The bare placeholder, adding no inset of its own. */
export const Inline: Story = {};

/** Filling a fixed box on its own. */
export const Fill: Story = {
  decorators: [
    (Story) => (
      <div
        style={{
          height: 160,
          display: "flex",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: { layout: "fill", children: "Waiting for the first telemetry frame" },
};
