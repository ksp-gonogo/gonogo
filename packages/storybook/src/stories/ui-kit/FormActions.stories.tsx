import {
  ActionButton,
  Button,
  ConfigForm,
  Field,
  FieldLabel,
  FormActions,
  GhostButton,
  Input,
  PrimaryButton,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { withGonogoFrame } from "../../frame";

function Column({ children }: { children: ReactNode }) {
  return <div style={{ width: 400 }}>{children}</div>;
}

const meta = {
  title: "ui-kit/FormActions",
  component: FormActions,
  decorators: [
    (Story) => (
      <Column>
        <Story />
      </Column>
    ),
    withGonogoFrame,
  ],
} satisfies Meta<typeof FormActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The foot of a form: save stays disabled until a field changes, and saving clears the change. */
export const SaveAndCancel: Story = {
  render: function Render() {
    const saved = "Kerbal X";
    const [name, setName] = useState(saved);
    const [stored, setStored] = useState(saved);
    const dirty = name !== stored;
    return (
      <ConfigForm $boxed>
        <Field>
          <FieldLabel htmlFor="a-name">Vessel name</FieldLabel>
          <Input
            id="a-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <FormActions>
          <Text level="muted" size="sm">
            {dirty ? "Unsaved changes" : "Saved"}
          </Text>
          <Button
            type="button"
            disabled={!dirty}
            onClick={() => setName(stored)}
          >
            Revert
          </Button>
          <PrimaryButton
            type="button"
            disabled={!dirty}
            onClick={() => setStored(name)}
          >
            Save
          </PrimaryButton>
        </FormActions>
      </ConfigForm>
    );
  },
};

/** Several button kinds in one row, spaced by the control-row gap and centred on one line. */
export const Mixed: Story = {
  render: () => (
    <FormActions>
      <GhostButton type="button" onClick={() => {}}>
        Reset to defaults
      </GhostButton>
      <Button type="button" onClick={() => {}}>
        Cancel
      </Button>
      <PrimaryButton type="button" onClick={() => {}}>
        Apply
      </PrimaryButton>
    </FormActions>
  ),
};

/** Compact row actions, the go-toned confirm drawing the eye to the pending step. */
export const RowActions: Story = {
  render: () => (
    <FormActions>
      <ActionButton onClick={() => {}}>Discard node</ActionButton>
      <ActionButton tone="go" onClick={() => {}}>
        Execute burn
      </ActionButton>
    </FormActions>
  ),
};
