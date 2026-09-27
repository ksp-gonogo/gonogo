import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { probePayload } from "../../../components/scripts/probe/payload";
import {
  renderProbe,
  unmountProbe,
} from "../../../components/scripts/probe/probe-entry";
import valentina from "../../../components/src/CrewStatus/__fixtures__/valentina-solo-orbit.json";
import { ExtensionScene } from "../ExtensionScene";
import { withGonogoFrame } from "../frame";
import { SceneSet } from "../SceneSet";
import { SCENES } from "../sceneSetScenes";
import { WidgetScene, type WidgetSceneProps } from "../WidgetScene";

/**
 * Deliberate failures for the smoke check to catch, one per way a story can
 * fail: a component that throws as it renders, a widget scene whose mount
 * rejects after the first render, and an extension story whose scene never
 * draws its extension, and a set of scenes sharing the page's one probe slot.
 * `scripts/smoke.ts` fails as BLIND if any is reported clean.
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

/** A widget scene in the page's one probe slot, where each mount replaces the last. */
function SlotScene({ widgetId, fixture, w, h, onMounted }: WidgetSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef(onMounted);
  mounted.current = onMounted;
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    queueMicrotask(() => {
      renderProbe(root, probePayload({ widgetId, fixture, size: { w, h } }))
        .then(() =>
          mounted.current?.({
            ready: Promise.resolve(),
            emit: () => {},
            unmount: unmountProbe,
          }),
        )
        .catch(() => {});
    });
  }, [widgetId, fixture, w, h]);
  return <div ref={host} data-scene="mounted" />;
}

/** Widget scenes that share one probe slot, so all but the last are emptied. */
export const SharedProbeSlot: StoryObj<typeof SceneSet> = {
  render: () => (
    <SceneSet
      scenes={SCENES.filter((scene) => scene.kind === "widget")}
      widgetScene={SlotScene}
    />
  ),
};
