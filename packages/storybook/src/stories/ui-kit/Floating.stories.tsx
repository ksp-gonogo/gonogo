import { Floating, Row, RowName, Stack, Text, Unit } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useRef } from "react";
import { withGonogoFrame } from "../../frame";
import { live } from "../../readings";

/** What a hover card over a vessel marker holds. */
function VesselCard() {
  return (
    <div
      style={{
        padding: "var(--inset-popover)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-regular)",
        background: "var(--color-surface-raised)",
        color: "var(--color-text-primary)",
        width: 220,
      }}
    >
      <Stack gap="related-dense">
        <Text weight="semibold">Mun Lander II</Text>
        <Row as="div">
          <RowName>Altitude</RowName>
          <Unit value={live("m", 12_480)} />
        </Row>
        <Row as="div">
          <RowName>Vertical speed</RowName>
          <Unit value={live("m/s", -4.2)} />
        </Row>
      </Stack>
    </div>
  );
}

/** The whole viewport around the frame, so the story's box holds wherever the layer lands. */
function Viewport({ children }: { children: ReactNode }) {
  return <div style={{ height: "100vh" }}>{children}</div>;
}

/** A marker the layer attaches to by reading its box, so the layer follows it wherever the page puts it. */
function AnchoredToMarker() {
  const marker = useRef<HTMLSpanElement>(null);
  const anchor = () => {
    const box = marker.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  return (
    <div style={{ paddingTop: 48, paddingLeft: 96 }}>
      <span
        ref={marker}
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          borderRadius: "var(--radius-circle)",
          background: "var(--color-accent-fg)",
        }}
      />
      <Floating anchor={anchor}>
        <VesselCard />
      </Floating>
    </div>
  );
}

const meta = {
  title: "ui-kit/Floating",
  component: Floating,
  decorators: [
    withGonogoFrame,
    (Story) => (
      <Viewport>
        <Story />
      </Viewport>
    ),
  ],
  args: { anchor: { x: 48, y: 48 }, children: <VesselCard /> },
} satisfies Meta<typeof Floating>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At a fixed viewport point, with room around it: the layer sits below and right of the anchor. */
export const AtPoint: Story = {};

/**
 * Anchored in the bottom-right corner of the viewport, where below-right would
 * run off screen: the layer flips to the anchor's other side on both axes.
 */
export const FlipsAtEdge: Story = {
  args: {
    anchor: () => ({ x: window.innerWidth - 24, y: window.innerHeight - 24 }),
  },
};

/** Anchored to an element rather than a point, by a function the layer re-reads whenever it re-places. */
export const FollowsElement: Story = {
  render: () => <AnchoredToMarker />,
};
