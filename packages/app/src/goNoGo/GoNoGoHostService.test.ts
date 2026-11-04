import { afterEach, describe, expect, it } from "vitest";
import { asHostService } from "../test/peerFakes";
import { GoNoGoHostService, type Vote } from "./GoNoGoHostService";

type Listener = (...args: unknown[]) => void;

class ScenePeers {
  private listeners = new Map<string, Set<Listener>>();

  private on(event: string, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return () => set.delete(cb);
  }

  fire(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  onPeerConnect = (cb: Listener) => this.on("connect", cb);
  onPeerDisconnect = (cb: Listener) => this.on("disconnect", cb);
  onStationInfo = (cb: Listener) => this.on("info", cb);
  onGonogoVote = (cb: Listener) => this.on("vote", cb);
  onGonogoAbort = (cb: Listener) => this.on("abort", cb);
  broadcast = () => {};
  sendToPeer = () => {};
}

const services: GoNoGoHostService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

function scene(stations: [string, Vote][]) {
  const peers = new ScenePeers();
  const service = new GoNoGoHostService(asHostService(peers));
  services.push(service);
  for (const [peerId, vote] of stations) {
    peers.fire("connect", peerId);
    peers.fire("info", peerId, { name: peerId });
    peers.fire("vote", peerId, vote);
  }
  return { peers, service };
}

describe("a voter leaving the poll", () => {
  it("starts the countdown when the only NO-GO station leaves and GO votes stand", () => {
    const { peers, service } = scene([
      ["a", "go"],
      ["b", "no-go"],
    ]);
    expect(service.getSnapshot().countdown).toBeNull();
    peers.fire("disconnect", "b");
    expect(service.getSnapshot().countdown).not.toBeNull();
  });

  it("starts nothing when a NO-GO station leaves and another NO-GO stands", () => {
    const { peers, service } = scene([
      ["a", "go"],
      ["b", "no-go"],
      ["c", "no-go"],
    ]);
    peers.fire("disconnect", "b");
    expect(service.getSnapshot().countdown).toBeNull();
  });
});
