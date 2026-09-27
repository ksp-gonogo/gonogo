import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../frame";
import { SceneSet } from "../SceneSet";
import { SCENES } from "../sceneSetScenes";

const meta = {
  title: "Probe/Scenes on one page",
  component: SceneSet,
  decorators: [withGonogoFrame],
} satisfies Meta<typeof SceneSet>;

export default meta;

/** Every scene mounts, and feeding one changes it and nothing else. */
export const Independent: StoryObj<typeof meta> = {
  args: { scenes: SCENES },
};
