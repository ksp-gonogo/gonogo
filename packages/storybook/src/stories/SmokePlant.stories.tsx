import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../frame";
import { WidgetScene } from "../WidgetScene";

/**
 * Deliberate failures for the smoke check to catch, one per way a story can
 * fail: a component that throws as it renders, and a widget scene whose mount
 * rejects after the first render. `scripts/smoke.ts` fails as BLIND if either
 * is reported clean.
 */
function Throws(): never {
  throw new Error("planted: this story throws on purpose");
}

const meta = {
  title: "Smoke plant",
  decorators: [withGonogoFrame],
} satisfies Meta;

export default meta;

export const RenderThrows: StoryObj = {
  render: () => <Throws />,
};

export const MountRejects: StoryObj = {
  render: () => (
    <WidgetScene widgetId="planted-not-registered" fixture={{}} w={6} h={6} />
  ),
};
