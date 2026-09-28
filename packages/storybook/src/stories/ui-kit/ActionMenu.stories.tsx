import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  ActionMenu,
  type ActionMenuItem,
  Button,
  Text,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useRef, useState } from "react";
import { withGonogoFrame } from "../../frame";

/** The menu positions itself absolutely, so the frame gives it an anchor and the room to open into. */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative", width: 360, height: 320 }}>
      {children}
    </div>
  );
}

const VESSEL_ACTIONS: ActionMenuItem[] = [
  { key: "stage", label: "Activate next stage", group: "Staging" },
  { key: "abort", label: "Abort", group: "Staging" },
  { key: "sas-pro", label: "SAS prograde", group: "Attitude" },
  { key: "sas-ret", label: "SAS retrograde", group: "Attitude" },
  { key: "sas-tgt", label: "SAS target", group: "Attitude", disabled: true },
  { key: "gear", label: "Toggle landing gear", group: "Action groups" },
  { key: "lights", label: "Toggle lights", group: "Action groups" },
];

const FLAT_ACTIONS: ActionMenuItem[] = [
  { key: "focus", label: "Focus Mun Lander II" },
  { key: "target", label: "Set as target" },
  { key: "rename", label: "Rename vessel" },
  { key: "recover", label: "Recover vessel", disabled: true },
];

const meta = {
  title: "ui-kit/ActionMenu",
  component: ActionMenu,
  decorators: [
    (Story) => (
      <Stage>
        <Story />
      </Stage>
    ),
    withGonogoFrame,
  ],
  args: {
    items: VESSEL_ACTIONS,
    ariaLabel: "Vessel actions",
    onSelect: () => {},
    onDismiss: () => {},
    style: { top: 0, left: 0 },
  },
} satisfies Meta<typeof ActionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open, with actions in named groups; a disabled item is dimmed and still reachable by arrow key. */
export const Grouped: Story = {};

/** Items with no group render as one flat list, with no headers. */
export const Flat: Story = {
  args: { items: FLAT_ACTIONS, ariaLabel: "Mun Lander II actions" },
};

/** A header naming the vessel and a footer with the signal delay, around the items. */
export const HeaderAndFooter: Story = {
  args: {
    items: FLAT_ACTIONS,
    header: (
      <div style={{ padding: "var(--inset-menu-group-label)" }}>
        <Text weight="semibold">Mun Lander II</Text>
      </div>
    ),
    footer: (
      <div style={{ padding: "var(--inset-menu-group-label)" }}>
        <Text level="muted" size="xs">
          Commands arrive in {writeQuantity(value("s", 1.6))}
        </Text>
      </div>
    ),
  },
};

/** A menu opened before its actions arrived: a labelled empty state, not an invalid empty menu. */
export const Empty: Story = {
  args: { items: [], emptyLabel: "No actions for this vessel" },
};

function TriggeredMenu() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div style={{ display: "grid", gap: "var(--gap-related)" }}>
      <div>
        <Button
          ref={trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Actions
        </Button>
      </div>
      <Text level="muted" size="xs">
        {last ? `Fired: ${last}` : "Nothing fired yet"}
      </Text>
      {open && (
        <ActionMenu
          items={VESSEL_ACTIONS}
          ariaLabel="Vessel actions"
          style={{ top: 44, left: 0 }}
          onSelect={(key) => {
            setLast(VESSEL_ACTIONS.find((a) => a.key === key)?.label ?? key);
            close();
          }}
          onDismiss={close}
        />
      )}
    </div>
  );
}

/** Closed behind its trigger: click to open, pick an action to fire it, Escape or an outside click to dismiss. */
export const Closed: Story = {
  render: () => <TriggeredMenu />,
};
