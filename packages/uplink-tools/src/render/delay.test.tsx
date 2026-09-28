// @vitest-environment jsdom
import {
  magnitudeOf,
  registerComponent,
  useTelemetry,
  useUtNow,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import { registerReckoner } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  installRenderProbe,
  payloadFor,
  type RenderProbeApi,
  sceneFromFixture,
  type UplinkInventory,
} from "../render-probe";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "probe.tank": { level: number };
  }
}

/** The level falls one unit a second, so a reckoned figure says how far it was carried. */
const DRAIN_PER_SECOND = 1;

function Level() {
  const reading = useTelemetry("probe.tank");
  const view = magnitudeOf(useViewUt());
  const present = useUtNow();
  const observed =
    "value" in reading ? String(reading.value?.level) : reading.state;
  const reckoned =
    reading.reckoning.status === "available"
      ? String(reading.reckoning.value?.level)
      : reading.reckoning.status;
  return (
    <p>
      {`observed ${observed}; modelled ${reckoned}; view ${String(view)}; present ${String(present)}`}
    </p>
  );
}

const INVENTORY: UplinkInventory = {
  id: "probe-delay",
  name: "Probe delay",
  version: "0.0.0",
  compat: {
    apiVersion: "1.0.0",
    uiKitVersion: "0.0.0",
    contractMajor: 0,
    contractMinor: 0,
  },
  declaredClients: ["core", "probe-delay"],
  widgets: [
    {
      id: "probe-level",
      name: "Level",
      description: "A level that drains.",
      tags: [],
      channels: ["probe.tank"],
      optionalChannels: [],
      dataRequirements: [],
      actions: [],
      augmentSlots: [],
      contributionSlots: [],
      requires: [],
      pushable: false,
      behaviors: [],
      modes: [{ name: "default", w: 6, h: 4, pxW: 232, pxH: 124 }],
    },
  ],
  augments: [],
  contributions: [],
  processors: [],
  processorTopicDeps: {},
  reckonedTopics: [],
  reckonerExemptions: [],
  derivedChannels: [],
  hosts: [],
};

let api: RenderProbeApi;

/*
 * The probe drives React as a browser page does, feeding the stream only once
 * a mount has subscribed. Inside `act` nothing commits until the scope closes,
 * so every emit would find no subscriber and the scene would render unfed.
 */
const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
});

beforeAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  document.body.innerHTML = '<div id="root"></div>';
  api = await installRenderProbe();
  registerComponent({
    id: "probe-level",
    name: "Level",
    description: "A level that drains.",
    tags: [],
    component: Level,
    channels: ["probe.tank"],
  });
  registerReckoner("probe.tank", "probe-delay", {
    deps: [],
    reckon: (point, _deps, frame) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: () => ({
        level:
          (point.payload?.level ?? 0) -
          DRAIN_PER_SECOND * (frame.reckonUt - point.validAt),
      }),
    }),
  });
});

async function render(stream: Record<string, unknown>): Promise<string> {
  const scene = sceneFromFixture(
    "level.json",
    "level.json",
    { _scene: { widget: "probe-level" }, _stream: stream },
    INVENTORY,
  );
  await api.renderScene(payloadFor(scene, scene.modes[0], false));
  // jsdom lays nothing out, so the report's visible text is empty; the DOM's own text is what was drawn.
  const text = document.getElementById("root")?.textContent ?? "";
  await api.unmountScene();
  return text;
}

describe('a fixture\'s "_stream.delaySeconds"', () => {
  it("delivers each reading a light time late and reckons it to the craft's present", async () => {
    const text = await render({
      pinnedUt: 1000,
      delaySeconds: 60,
      emits: [{ topic: "probe.tank", payload: { level: 100 } }],
    });
    expect(text).toBe("observed 100; modelled 40; view 1000; present 1060");
  });

  it("draws the observed figure alone with no light time, the clock pinned at the received edge", async () => {
    const text = await render({
      pinnedUt: 1000,
      emits: [{ topic: "probe.tank", payload: { level: 100 } }],
    });
    expect(text).toMatch(/^observed 100; modelled 100; view 1000;/);
  });

  it("treats a zero delay as no delay", () => {
    const scene = sceneFromFixture(
      "level.json",
      "level.json",
      {
        _scene: { widget: "probe-level" },
        _stream: { delaySeconds: 0, emits: [] },
      },
      INVENTORY,
    );
    expect("delaySeconds" in payloadFor(scene, scene.modes[0], false)).toBe(
      false,
    );
  });

  it.each([
    [-5],
    ["60"],
    [Number.POSITIVE_INFINITY],
  ])("refuses %s, which is not a light time", (delay) => {
    expect(() =>
      sceneFromFixture(
        "level.json",
        "level.json",
        {
          _scene: { widget: "probe-level" },
          _stream: { delaySeconds: delay, emits: [] },
        },
        INVENTORY,
      ),
    ).toThrow(/delaySeconds.*one-way light time/);
  });

  it("refuses a step that runs a delayed clock backwards", () => {
    expect(() =>
      sceneFromFixture(
        "level.json",
        "level.json",
        {
          _scene: { widget: "probe-level", steps: [{ advanceUt: -10 }] },
          _stream: { delaySeconds: 60, emits: [] },
        },
        INVENTORY,
      ),
    ).toThrow(/negative "advanceUt"/);
  });
});
