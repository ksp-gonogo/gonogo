import type { DataConnection } from "peerjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachIceDiagnostics } from "../peer/PeerClientService";

/**
 * Minimal RTCPeerConnection stand-in: just enough surface for
 * attachIceDiagnostics to read `iceConnectionState` / `connectionState`
 * and register listeners. `set(...)` mutates the state then fires the
 * matching change event, mirroring a real PC transition.
 */
class FakePc {
  iceConnectionState: RTCIceConnectionState = "checking";
  iceGatheringState: RTCIceGatheringState = "gathering";
  connectionState: RTCPeerConnectionState = "connecting";
  signalingState: RTCSignalingState = "stable";
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(event: string, cb: () => void) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  private emit(event: string) {
    this.listeners.get(event)?.forEach((cb) => {
      cb();
    });
  }

  setIce(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.emit("iceconnectionstatechange");
  }

  setConnection(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.emit("connectionstatechange");
  }
}

class FakeConn {
  peer = "gonogo-host-TEST";
  peerConnection: FakePc;
  private listeners = new Map<string, Array<() => void>>();

  constructor(pc: FakePc) {
    this.peerConnection = pc;
  }

  on(event: string, cb: () => void) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  emit(event: string) {
    this.listeners.get(event)?.forEach((cb) => {
      cb();
    });
  }
}

function wire() {
  const pc = new FakePc();
  const conn = new FakeConn(pc);
  const onDead = vi.fn();
  attachIceDiagnostics(conn as unknown as DataConnection, onDead);
  return { pc, conn, onDead };
}

describe("attachIceDiagnostics liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onDead immediately on iceConnectionState=failed", () => {
    const { pc, onDead } = wire();
    pc.setIce("failed");
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("fires onDead on iceConnectionState=closed", () => {
    const { pc, onDead } = wire();
    pc.setIce("closed");
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("fires onDead on connectionState=failed", () => {
    const { pc, onDead } = wire();
    pc.setConnection("failed");
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("fires onDead when 'disconnected' persists past the grace window", () => {
    const { pc, onDead } = wire();
    pc.setIce("disconnected");
    expect(onDead).not.toHaveBeenCalled(); // grace timer pending
    vi.advanceTimersByTime(4_000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onDead when 'disconnected' recovers to 'connected' before the grace", () => {
    const { pc, onDead } = wire();
    pc.setIce("disconnected");
    // Recover well before the 4s grace elapses.
    vi.advanceTimersByTime(1_000);
    pc.setIce("connected");
    // Run out the rest of the original grace window.
    vi.advanceTimersByTime(5_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it("does NOT fire onDead when 'disconnected' recovers to 'completed'", () => {
    const { pc, onDead } = wire();
    pc.setIce("disconnected");
    vi.advanceTimersByTime(1_000);
    pc.setIce("completed");
    vi.advanceTimersByTime(5_000);
    expect(onDead).not.toHaveBeenCalled();
  });

  it("fires onDead at most once per dead connection", () => {
    const { pc, onDead } = wire();
    pc.setIce("failed");
    pc.setConnection("failed");
    pc.setIce("closed");
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("a pending grace timer cannot fire after the conn closes", () => {
    const { pc, conn, onDead } = wire();
    pc.setIce("disconnected"); // arm the grace timer
    conn.emit("close"); // clean teardown
    vi.advanceTimersByTime(10_000);
    expect(onDead).not.toHaveBeenCalled();
  });
});
