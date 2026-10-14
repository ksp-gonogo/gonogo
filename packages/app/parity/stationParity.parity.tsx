/**
 * Station parity gate: every widget draws on a station what it draws on the
 * main screen, except where it is meant to differ.
 *
 * Each scene is a widget fixture rendered twice, once on the main screen fed
 * by the mod and once on a station that joins late and is fed only by what the
 * host relays over PeerJS. See `parityHarness.tsx` for what is real.
 *
 * The comparison is the rendered markup with build-volatile class names and
 * ids stripped, which carries the text and every attribute a drawing is made
 * of. Canvas pixels are not compared.
 *
 *   pnpm --filter @ksp-gonogo/app parity-gate
 *   PARITY_SCENE=current-orbit pnpm --filter @ksp-gonogo/app parity-gate
 */

vi.mock("peerjs", async (importOriginal) => {
  const real = await importOriginal<typeof import("peerjs")>();
  const { makeFakePeerjs } = await import("./fakePeerjs");
  return { ...real, default: makeFakePeerjs(real.util) };
});

import "@ksp-gonogo/components";
import "../src/goNoGo/GoNoGoComponent";
import "../src/notes/NotesComponent";
import { getComponent } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEANT_TO_DIFFER, PARITY_DEBT } from "./exceptions";
import { channelPlant, clearChannelPlant, resetFakePeers } from "./fakePeerjs";
import {
  describeDifference,
  discoverScenes,
  type ParityScene,
  renderScene,
} from "./parityHarness";

const scenes = discoverScenes();
const only = process.env.PARITY_SCENE;
const selected = only ? scenes.filter((s) => s.id.includes(only)) : scenes;

afterEach(() => {
  clearChannelPlant();
  resetFakePeers();
  localStorage.clear();
});

function relayedTopic(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const envelope = message as { type?: string; message?: { topic?: unknown } };
  if (envelope.type !== "sitrep-frame") return undefined;
  const topic = envelope.message?.topic;
  return typeof topic === "string" ? topic : undefined;
}

const CANARY_ID = "current-orbit/circular-lko";
const CANARY_TOPIC = "system.bodies";

function canary(): ParityScene {
  const scene = scenes.find((s) => s.id === CANARY_ID);
  if (!scene) throw new Error(`BLIND: the canary scene ${CANARY_ID} is gone`);
  if (!scene.emits.some((e) => e.channel === CANARY_TOPIC)) {
    throw new Error(`BLIND: ${CANARY_ID} no longer emits ${CANARY_TOPIC}`);
  }
  return scene;
}

/**
 * The gate proves it can see the fault it exists for before its verdicts mean
 * anything. Each plant loses one frame the canary's widget draws from, the way
 * the packer refusing a body's mass once lost `system.bodies` for every
 * station, and the station must then draw something else. A plant the gate
 * cannot see means every green below is a gate that cannot see either.
 */
describe("the parity gate can see a lost frame", () => {
  it("the canary matches with nothing planted", async () => {
    const renders = await renderScene(canary());
    expect(renders.mainText).toContain("Kerbin");
    expect(renders.station === renders.main, describeDifference(renders)).toBe(
      true,
    );
  });

  it("sees a frame the packer refuses", async () => {
    channelPlant.refuse = (m) => relayedTopic(m) === CANARY_TOPIC;
    const renders = await renderScene(canary());
    if (renders.station === renders.main) {
      throw new Error(
        `BLIND: the station drew the main screen's ${CANARY_ID} with every ${CANARY_TOPIC} frame refused by the packer`,
      );
    }
  });

  it("sees a topic the relay drops", async () => {
    channelPlant.drop = (m) => relayedTopic(m) === CANARY_TOPIC;
    const renders = await renderScene(canary());
    if (renders.station === renders.main) {
      throw new Error(
        `BLIND: the station drew the main screen's ${CANARY_ID} with every ${CANARY_TOPIC} frame dropped`,
      );
    }
  });
});

describe("the exception and debt lists", () => {
  it("name only registered widgets and existing scenes", () => {
    for (const id of Object.keys(MEANT_TO_DIFFER)) {
      expect(getComponent(id), `${id} is not a registered widget`).toBeTruthy();
    }
    const ids = new Set(scenes.map((s) => s.id));
    for (const id of Object.keys(PARITY_DEBT)) {
      expect(ids.has(id), `${id} is not a scene`).toBe(true);
    }
  });
});

describe("a station draws what the main screen draws", () => {
  for (const scene of selected) {
    const reason = MEANT_TO_DIFFER[scene.widgetId];
    if (reason !== undefined) {
      it.skip(`${scene.id}: meant to differ, ${reason}`, () => {});
      continue;
    }
    it(scene.id, async () => {
      const renders = await renderScene(scene);
      const debt = PARITY_DEBT[scene.id];
      const matches = renders.station === renders.main;
      if (debt === undefined) {
        expect(matches, describeDifference(renders)).toBe(true);
        return;
      }
      expect(
        matches,
        `${scene.id} now matches: remove it from PARITY_DEBT`,
      ).toBe(false);
    });
  }
});
