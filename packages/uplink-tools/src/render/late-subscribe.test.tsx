// @vitest-environment jsdom
import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  installRenderProbe,
  payloadFor,
  type RenderProbeApi,
  sceneFromFixture,
  type UplinkInventory,
} from "../render-probe";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "probe.late": { level: number };
  }
}

/**
 * A mount whose subscriber arrives after the frames the probe waits before
 * feeding, which is what a loaded machine does to an ordinary widget: React
 * commits on its own scheduler, and the two frames can pass first.
 */
const FRAMES_BEFORE_SUBSCRIBING = 4;

function Reader() {
  const reading = useTelemetry("probe.late");
  return (
    <p>{"value" in reading ? String(reading.value?.level) : reading.state}</p>
  );
}

function LateLevel() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let frames = FRAMES_BEFORE_SUBSCRIBING;
    let handle = 0;
    const tick = () => {
      frames -= 1;
      if (frames <= 0) setReady(true);
      else handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);
  return ready ? <Reader /> : <p>mounting</p>;
}

const INVENTORY: UplinkInventory = {
  id: "probe-late",
  name: "Probe late",
  version: "0.0.0",
  compat: {
    apiVersion: "1.0.0",
    contractMajor: 0,
    contractMinor: 0,
  },
  declaredClients: ["core", "probe-late"],
  widgets: [
    {
      id: "probe-late-level",
      name: "Late level",
      description: "A level read by a child that mounts late.",
      tags: [],
      channels: ["probe.late"],
      optionalChannels: [],
      dataRequirements: [],
      actions: [],
      augmentSlots: [],
      contributionSlots: [],
      requires: [],
      pushable: false,
      fields: [],
      replaces: null,
      defaultSize: null,
      minSize: null,
      tiny: false,
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

// The probe drives React as a page does; inside `act` nothing would commit until the scope closed.
const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
afterAll(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
});

beforeAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  document.body.innerHTML = '<div id="root"></div>';
  api = await installRenderProbe();
  registerComponent({
    id: "probe-late-level",
    name: "Late level",
    description: "A level read by a child that mounts late.",
    tags: [],
    component: LateLevel,
    channels: ["probe.late"],
  });
});

describe("a subscriber that mounts after the probe's first frames", () => {
  it("still receives the scene's emits", async () => {
    const scene = sceneFromFixture(
      "late.json",
      "late.json",
      {
        _scene: { widget: "probe-late-level" },
        _stream: {
          pinnedUt: 1000,
          emits: [{ topic: "probe.late", payload: { level: 42 } }],
        },
      },
      INVENTORY,
    );
    await api.renderScene(payloadFor(scene, scene.modes[0], false));
    const drawn = () => document.getElementById("root")?.textContent ?? "";
    await vi.waitFor(() => expect(drawn()).toBe("42"));
    await api.unmountScene();
  });
});
