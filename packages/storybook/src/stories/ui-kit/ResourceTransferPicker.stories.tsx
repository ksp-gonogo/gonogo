import { useTransferPick } from "@ksp-gonogo/sitrep-sdk";
import { ResourceTransferPicker } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";
import { transferModel } from "./resourceTransferFixtures";

function Picker({ form }: { form: "list" | "tray" }) {
  const state = useTransferPick("LiquidFuel");
  return (
    <div style={{ width: 420 }}>
      <ResourceTransferPicker
        transfer={transferModel()}
        state={state}
        form={form}
        onCancel={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "ui-kit/ResourceTransferPicker",
  component: Picker,
  decorators: [withGonogoFrame],
  args: { form: "list" },
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every tank with its choices, with a locked tank and an out-only one. */
export const List: Story = {};

/** The one-line form for a surface where the tanks are picked elsewhere. */
export const Tray: Story = { args: { form: "tray" } };
