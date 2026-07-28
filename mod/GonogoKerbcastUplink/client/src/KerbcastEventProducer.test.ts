import {
  type AdaptiveShedPayload,
  CameraLifecycle,
  type CameraState,
  type KerbcastClientEvents,
} from "@ksp-gonogo/kerbcast";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type KerbcastEdgeSource,
  KerbcastEventProducer,
} from "./KerbcastEventProducer";

/** In-memory stand-in for the kerbcast SDK client, no WebRTC. */
class FakeClient implements KerbcastEdgeSource {
  clock: { captureUt: number | null; epoch: number } = {
    captureUt: 100,
    epoch: 0,
  };
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  on<K extends keyof KerbcastClientEvents>(
    event: K,
    handler: (payload: KerbcastClientEvents[K]) => void,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (p: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(handler as (p: unknown) => void);
  }

  emit<K extends keyof KerbcastClientEvents>(
    event: K,
    payload: KerbcastClientEvents[K],
  ): void {
    this.listeners.get(event)?.forEach((cb) => {
      cb(payload);
    });
  }
}

function cam(
  flightId: number,
  lifecycle: CameraLifecycle = CameraLifecycle.Active,
): CameraState {
  return {
    flightId,
    partTitle: `Part ${flightId}`,
    cameraName: `Cam ${flightId}`,
    vesselName: `Vessel ${flightId}`,
    lifecycle,
  } as CameraState;
}

function shed(level: number): AdaptiveShedPayload {
  return { level, kspFps: level > 0 ? 12 : 60, reason: "ksp-fps-low" };
}

describe("KerbcastEventProducer", () => {
  let client: FakeClient;
  let producer: KerbcastEventProducer;

  beforeEach(() => {
    client = new FakeClient();
    producer = new KerbcastEventProducer();
    producer.attach(client);
  });

  const kinds = () => producer.events.all().map((o) => o.kind);

  describe("camera add / remove diffing", () => {
    it("treats the first snapshot as a silent baseline", () => {
      client.emit("cameras-change", [cam(1), cam(2)]);
      expect(producer.events.all()).toHaveLength(0);
    });

    it("emits camera-added for a newly appearing camera", () => {
      client.emit("cameras-change", [cam(1)]); // baseline
      client.emit("cameras-change", [cam(1), cam(2)]);
      const occ = producer.events.all();
      expect(occ).toHaveLength(1);
      expect(occ[0].kind).toBe("camera-added");
      expect(occ[0].payload).toMatchObject({
        flightId: 2,
        partTitle: "Part 2",
      });
    });

    it("emits camera-removed for a camera that disappears", () => {
      client.emit("cameras-change", [cam(1), cam(2)]); // baseline
      client.emit("cameras-change", [cam(1)]);
      const occ = producer.events.all();
      expect(occ).toHaveLength(1);
      expect(occ[0].kind).toBe("camera-removed");
      expect(occ[0].payload).toEqual({ flightId: 2 });
    });

    it("emits signal-lost when a camera transitions to destroyed", () => {
      client.emit("cameras-change", [cam(1)]); // baseline: active
      client.emit("cameras-change", [cam(1, CameraLifecycle.Destroyed)]);
      const occ = producer.events.all();
      expect(occ).toHaveLength(1);
      expect(occ[0].kind).toBe("signal-lost");
      expect(occ[0].payload).toMatchObject({
        flightId: 1,
        reason: "camera-destroyed",
      });
    });
  });

  describe("stream degrade", () => {
    it("emits stream-degraded for a positive shed level", () => {
      client.emit("adaptive-shed", shed(0.5));
      const occ = producer.events.all();
      expect(occ).toHaveLength(1);
      expect(occ[0].kind).toBe("stream-degraded");
      expect(occ[0].payload).toMatchObject({ level: 0.5 });
    });

    it("ignores a shed back to nominal (level 0)", () => {
      client.emit("adaptive-shed", shed(0));
      expect(producer.events.all()).toHaveLength(0);
    });
  });

  describe("signal loss", () => {
    it("emits signal-lost when the scene leaves flight", () => {
      client.emit("scene-change", false);
      expect(kinds()).toEqual(["signal-lost"]);
    });

    it("does not emit on entering flight", () => {
      client.emit("scene-change", true);
      expect(producer.events.all()).toHaveLength(0);
    });

    it("emits signal-lost when a connected client disconnects", () => {
      client.emit("state-change", "connected");
      client.emit("state-change", "disconnected");
      const occ = producer.events.all();
      expect(occ).toHaveLength(1);
      expect(occ[0].payload).toMatchObject({
        reason: "connection-disconnected",
      });
    });

    it("does not emit on a disconnect before ever connecting", () => {
      client.emit("state-change", "disconnected");
      expect(producer.events.all()).toHaveLength(0);
    });
  });

  describe("UT stamping", () => {
    it("stamps the occurrence with the capture clock ut + epoch", () => {
      client.clock = { captureUt: 4242, epoch: 3 };
      client.emit("scene-change", false);
      const occ = producer.events.all()[0];
      expect(occ.ut).toBe(4242);
      expect(occ.epoch).toBe(3);
    });

    it("drops an edge when no capture ut is known yet", () => {
      client.clock = { captureUt: null, epoch: 0 };
      client.emit("scene-change", false);
      expect(producer.events.all()).toHaveLength(0);
    });
  });

  describe("reveal gating at the delayed view clock", () => {
    it("hides an occurrence until the view clock reaches its ut", () => {
      client.clock = { captureUt: 500, epoch: 0 };
      client.emit("scene-change", false);
      expect(producer.revealed(499)).toEqual([]);
      expect(producer.revealed(500)).toHaveLength(1);
    });

    it("returns empty when the view ut is unknown", () => {
      client.clock = { captureUt: 500, epoch: 0 };
      client.emit("scene-change", false);
      expect(producer.revealed(null)).toEqual([]);
      expect(producer.revealed(undefined)).toEqual([]);
    });
  });

  describe("client lifecycle", () => {
    it("stops recording after detach", () => {
      producer.detach();
      client.emit("scene-change", false);
      expect(producer.events.all()).toHaveLength(0);
    });

    it("resets the camera baseline on re-attach (reconnect doesn't replay adds)", () => {
      client.emit("cameras-change", [cam(1)]); // baseline on first client
      producer.detach();
      const client2 = new FakeClient();
      producer.attach(client2);
      client2.emit("cameras-change", [cam(1)]); // fresh baseline, not an add
      expect(producer.events.all()).toHaveLength(0);
    });
  });
});
