import type { Preview } from "@storybook/react-vite";
import "../src/setup";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
  },
};

export default preview;
