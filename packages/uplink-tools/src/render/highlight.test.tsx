// @vitest-environment jsdom
import {
  AugmentSlot,
  registerAugment,
  registerComponent,
} from "@ksp-gonogo/sitrep-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  installRenderProbe,
  payloadFor,
  type RenderProbeApi,
  sceneFromFixture,
  type UplinkInventory,
} from "../render-probe";
import { SUPPLIED_ATTR } from "./probe-global";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "probe-host.sections": Record<string, never>;
  }
}

const SLOT = "probe-host.sections";

const INVENTORY: UplinkInventory = {
  id: "probe-highlight",
  name: "Probe highlight",
  version: "0.0.0",
  compat: {
    apiVersion: "1.0.0",
    uiKitVersion: "0.0.0",
    contractMajor: 0,
    contractMinor: 0,
  },
  declaredClients: ["core", "probe-highlight"],
  widgets: [],
  augments: [
    {
      id: "probe-supplied",
      augments: SLOT,
      channels: [],
      suppressesVanillaBase: false,
      settings: [],
    },
  ],
  contributions: [],
  processors: [],
  processorTopicDeps: {},
  reckonedTopics: [],
  reckonerExemptions: [],
  derivedChannels: [],
  hosts: [
    {
      id: "probe-host",
      name: "Host",
      description: "A widget some other package owns.",
      tags: [],
      channels: [],
      optionalChannels: [],
      dataRequirements: [],
      actions: [],
      augmentSlots: [SLOT],
      contributionSlots: [],
      requires: [],
      pushable: false,
      behaviors: [],
      modes: [{ name: "default", w: 6, h: 4, pxW: 232, pxH: 124 }],
    },
  ],
};

let api: RenderProbeApi;

const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
});

beforeAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  document.body.innerHTML = '<div id="root"></div>';
  api = await installRenderProbe();
  registerComponent({
    id: "probe-host",
    name: "Host",
    description: "A widget some other package owns.",
    tags: [],
    component: () => (
      <div id="host-body">
        <p>host's own row</p>
        <AugmentSlot name={SLOT} props={{}} />
      </div>
    ),
    augmentSlots: [SLOT],
  } as never);
  registerAugment({
    id: "probe-supplied",
    augments: SLOT,
    component: () => <p>supplied row</p>,
  } as never);
});

async function render(scene: Record<string, unknown>): Promise<HTMLElement> {
  const parsed = sceneFromFixture(
    "supplied.json",
    "supplied.json",
    {
      _scene: { augment: "probe-supplied", hostWidget: "probe-host", ...scene },
    },
    INVENTORY,
  );
  await api.renderScene(payloadFor(parsed, parsed.modes[0], false));
  const root = document.getElementById("root") as HTMLElement;
  await vi.waitFor(() => expect(root.textContent).toContain("supplied row"));
  return root;
}

describe('a scene\'s "_scene.highlight"', () => {
  it("draws the augment inside a wrapper with no box, beside the host's own row", async () => {
    const root = await render({ highlight: true });
    const wrapper = root.querySelector(`[${SUPPLIED_ATTR}]`);
    expect(wrapper?.textContent).toBe("supplied row");
    expect(wrapper?.parentElement?.id).toBe("host-body");
    expect(wrapper?.getAttribute("style")).toContain("display: contents");
    expect(
      document.querySelector("style[data-probe-chrome='supplied']"),
    ).not.toBeNull();
    await api.unmountScene();
  });

  it("leaves the DOM exactly as it was when the scene does not ask", async () => {
    const root = await render({});
    expect(root.querySelector(`[${SUPPLIED_ATTR}]`)).toBeNull();
    await api.unmountScene();
  });

  it("puts the registry back after the scene, so the next one is unmarked", async () => {
    await render({ highlight: true });
    await api.unmountScene();
    const root = await render({});
    expect(root.querySelector(`[${SUPPLIED_ATTR}]`)).toBeNull();
    await api.unmountScene();
  });

  it("is refused for an augment with no real host, which would only outline the stand-in", () => {
    expect(() =>
      sceneFromFixture(
        "supplied.json",
        "supplied.json",
        { _scene: { augment: "probe-supplied", highlight: true } },
        INVENTORY,
      ),
    ).toThrow(/highlight/);
  });
});
