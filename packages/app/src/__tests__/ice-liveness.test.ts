import { type LogEntry, logger } from "@ksp-gonogo/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iceAddressClass, iceServerUrlParts } from "../peer/iceDiagnostics";
import { attachIceDiagnostics } from "../peer/PeerClientService";
import { asDataConnection } from "../test/peerFakes";

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
  private listeners = new Map<string, Array<(ev?: unknown) => void>>();

  addEventListener(event: string, cb: (ev?: unknown) => void) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  emit(event: string, ev?: unknown) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(ev);
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
  attachIceDiagnostics(asDataConnection(conn), onDead);
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

describe("attachIceDiagnostics candidate logging", () => {
  it("logs the class of a candidate's address and never the address", () => {
    const sent: LogEntry[] = [];
    const transport = {
      send: (entries: readonly LogEntry[]) => {
        sent.push(...entries);
      },
    };
    const wasEnabled = logger.isEnabled();
    logger.setEnabled(true);
    logger.addTransport(transport);
    try {
      const { pc } = wire();
      pc.emit("icecandidate", {
        candidate: {
          type: "srflx",
          protocol: "udp",
          address: "203.0.113.77",
          port: 50000,
          relatedAddress: "192.168.1.23",
        },
      });
    } finally {
      logger.removeTransport(transport);
      logger.setEnabled(wasEnabled);
    }
    const shipped = JSON.stringify(sent);
    expect(shipped).not.toContain("203.0.113.77");
    expect(shipped).not.toContain("192.168.1.23");
    const entry = sent.find((e) => e.message.includes("icecandidate"));
    expect(entry?.context).toMatchObject({
      addressClass: "public",
      relatedAddressClass: "private",
    });
  });

  it("logs the class of a failing ICE server's address and never the address", () => {
    const sent: LogEntry[] = [];
    const transport = {
      send: (entries: readonly LogEntry[]) => {
        sent.push(...entries);
      },
    };
    const wasEnabled = logger.isEnabled();
    logger.setEnabled(true);
    logger.addTransport(transport);
    try {
      const { pc } = wire();
      pc.emit("icecandidateerror", {
        url: "turn:198.51.100.9:3478?transport=udp",
        errorCode: 701,
        errorText: "timed out",
      });
    } finally {
      logger.removeTransport(transport);
      logger.setEnabled(wasEnabled);
    }
    expect(JSON.stringify(sent)).not.toContain("198.51.100.9");
    const entry = sent.find((e) => e.message.includes("icecandidateerror"));
    expect(entry?.context).toMatchObject({
      serverScheme: "turn",
      serverAddressClass: "public",
      serverPort: 3478,
      errorCode: 701,
    });
  });

  it("reads the scheme, class and port out of an ICE server URL", () => {
    expect(iceServerUrlParts("stun:stun.example.org")).toEqual({
      serverScheme: "stun",
      serverAddressClass: "hostname",
      serverPort: null,
    });
    expect(iceServerUrlParts("turns:[fd00::1]:5349").serverAddressClass).toBe(
      "private",
    );
    expect(iceServerUrlParts(undefined).serverScheme).toBe("unknown");
  });

  it("classifies candidate addresses", () => {
    expect(iceAddressClass(null)).toBe("none");
    expect(iceAddressClass("3f2a9c1e.local")).toBe("mdns");
    expect(iceAddressClass("127.0.0.1")).toBe("loopback");
    expect(iceAddressClass("10.1.2.3")).toBe("private");
    expect(iceAddressClass("172.20.0.4")).toBe("private");
    expect(iceAddressClass("172.32.0.4")).toBe("public");
    expect(iceAddressClass("fe80::1")).toBe("private");
    expect(iceAddressClass("2001:db8::1")).toBe("public");
  });
});
