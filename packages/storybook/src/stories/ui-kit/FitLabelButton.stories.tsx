import {
  ArrowUpIcon,
  FitLabelButton,
  PlayIcon,
  SatelliteIcon,
  SettingsIcon,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

/**
 * The kit button carries no styling of its own, so these stories dress it the
 * way a widget does: a bordered control that can shrink below its label.
 */
const CONTROL: CSSProperties = {
  minWidth: 0,
  fontFamily: "inherit",
  fontSize: "var(--font-size-compact)",
  fontWeight: 600,
  padding: "var(--inset-control)",
  borderRadius: "var(--radius-regular)",
  border: "1px solid var(--color-border-subtle)",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
};

/** A row of equal cells, each as wide as the given width allows. */
function Cells({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div
      style={{
        width,
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(0, 1fr)",
        gap: "var(--gap-related-compact)",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "ui-kit/FitLabelButton",
  component: FitLabelButton,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: {
    label: "Upgrade",
    icon: <ArrowUpIcon />,
    style: CONTROL,
    onClick: () => {},
  },
} satisfies Meta<typeof FitLabelButton>;

export default meta;
type Story = StoryObj<typeof meta>;

function FacilityRow({ width }: { width: number }) {
  return (
    <Cells width={width}>
      <FitLabelButton label="Upgrade" icon={<ArrowUpIcon />} style={CONTROL} />
      <FitLabelButton
        label="Tracking"
        icon={<SatelliteIcon />}
        style={CONTROL}
      />
      <FitLabelButton label="Launch" icon={<PlayIcon />} style={CONTROL} />
      <FitLabelButton
        label="Settings"
        icon={<SettingsIcon />}
        style={CONTROL}
      />
    </Cells>
  );
}

/** The same four-button row at a wide and a narrow width: words where they fit, icons where they do not. */
export const WideAndNarrow: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--gap-section)" }}>
      <FacilityRow width={400} />
      <FacilityRow width={170} />
    </div>
  ),
};

/** Room for the word: the label is drawn. */
export const LabelFits: Story = {
  render: (args) => (
    <Cells width={160}>
      <FitLabelButton {...args} />
    </Cells>
  ),
};

/** Too narrow for the word: the icon takes its place and the accessible name stays "Upgrade". */
export const IconFallback: Story = {
  render: (args) => (
    <Cells width={44}>
      <FitLabelButton {...args} />
    </Cells>
  ),
};

/** A disabled upgrade whose reason travels in `title`, the one explanation left once the word is gone. */
export const DisabledWithReason: Story = {
  render: () => (
    <Cells width={260}>
      <FitLabelButton
        label="Upgrade VAB"
        icon={<ArrowUpIcon />}
        disabled
        title="Costs 253,000 funds; the career holds 189,412"
        style={{ ...CONTROL, opacity: 0.5, cursor: "not-allowed" }}
      />
      <FitLabelButton
        label="Upgrade VAB"
        icon={<ArrowUpIcon />}
        disabled
        title="Costs 253,000 funds; the career holds 189,412"
        style={{
          ...CONTROL,
          opacity: 0.5,
          cursor: "not-allowed",
          maxWidth: 44,
        }}
      />
    </Cells>
  ),
};
