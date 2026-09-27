import type { Meta, StoryObj } from "@storybook/react-vite";
import valentina from "../../../components/src/CrewStatus/__fixtures__/valentina-solo-orbit.json";
import { ExtensionScene } from "../ExtensionScene";
import { withGonogoFrame } from "../frame";
import { WidgetScene } from "../WidgetScene";

/**
 * Deliberate failures for the smoke check to catch, one per way a story can
 * fail: a component that throws as it renders, a widget scene whose mount
 * rejects after the first render, and an extension story whose scene never
 * draws its extension. `scripts/smoke.ts` fails as BLIND if any is reported
 * clean.
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

/** A ship-map contribution switched on in a crew roster, which never draws it. */
export const ExtensionUnexercised: StoryObj<typeof ExtensionScene> = {
  render: (args) => <ExtensionScene {...args} />,
  args: {
    widgetId: "crew-status",
    fixture: valentina,
    w: 6,
    h: 8,
    extension: "core:ship-map-part-meters",
    enabled: true,
  },
};
