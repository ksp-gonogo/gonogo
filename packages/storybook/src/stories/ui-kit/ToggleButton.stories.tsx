import { Cluster, ToggleButton } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 420 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/ToggleButton",
  component: ToggleButton,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
  args: { children: "SAS", active: true },
} satisfies Meta<typeof ToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const WARP_RATES = ["1×", "5×", "10×", "50×", "100×", "1000×"] as const;

/** A row of time-warp rates: exactly one is pressed, and pressing another moves it. */
export const WarpRates: Story = {
  render: () => {
    const [rate, setRate] = useState<string>("10×");
    return (
      <Cluster justify="start" gap="related-compact">
        {WARP_RATES.map((r) => (
          <ToggleButton key={r} active={r === rate} onClick={() => setRate(r)}>
            {r}
          </ToggleButton>
        ))}
      </Cluster>
    );
  },
};

/** One control switched on: the tone fill and `aria-pressed="true"`. */
export const Pressed: Story = {
  args: { children: "SAS", active: true },
};

/** The same control off: a raised surface with muted text. */
export const Unpressed: Story = {
  args: { children: "SAS", active: false },
};

/** A standalone toggle that flips itself when clicked. */
export const Interactive: Story = {
  render: () => {
    const [on, setOn] = useState(false);
    return (
      <ToggleButton active={on} onClick={() => setOn((v) => !v)}>
        {on ? "RCS on" : "RCS off"}
      </ToggleButton>
    );
  },
};

/** Each tone, pressed beside its unpressed peer. */
export const Tones: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--gap-related)" }}>
      {(
        [
          ["neutral", "Map view"],
          ["go", "Launch clamps"],
          ["warn", "Physics warp"],
          ["nogo", "Abort armed"],
        ] as const
      ).map(([tone, label]) => (
        <Cluster key={tone} justify="start" gap="related-compact">
          <ToggleButton tone={tone} active>
            {label}
          </ToggleButton>
          <ToggleButton tone={tone}>{label}</ToggleButton>
        </Cluster>
      ))}
    </div>
  ),
};

/** The small size for a dense filter row, at the same control height. */
export const SmallFilters: Story = {
  render: () => {
    const [shown, setShown] = useState<Set<string>>(
      new Set(["Vessels", "Debris"]),
    );
    const toggle = (name: string) =>
      setShown((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
          return next;
        }
        next.add(name);
        return next;
      });
    return (
      <Cluster justify="start" gap="related-compact" wrap>
        {["Vessels", "Debris", "Flags", "Asteroids", "Kerbals"].map((name) => (
          <ToggleButton
            key={name}
            size="sm"
            active={shown.has(name)}
            onClick={() => toggle(name)}
          >
            {name}
          </ToggleButton>
        ))}
      </Cluster>
    );
  },
};

/** A disabled toggle, pressed and unpressed, dimmed and not clickable. */
export const Disabled: Story = {
  render: () => (
    <Cluster justify="start" gap="related-compact">
      <ToggleButton active disabled title="No probe core on Mun Lander II">
        Hold prograde
      </ToggleButton>
      <ToggleButton disabled title="No probe core on Mun Lander II">
        Hold retrograde
      </ToggleButton>
    </Cluster>
  ),
};
