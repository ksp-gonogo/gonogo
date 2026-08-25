import { logger } from "@ksp-gonogo/logger";
import type { DataConnection } from "peerjs";

const iceLog = logger.tag("peer:ice");

/**
 * Wire ICE diagnostics on a data connection. peerjs surfaces only opaque
 * `open` / `close` / `error` events; without these we can't tell if a
 * connection that "never opens" is failing at candidate gathering, ICE
 * checking, DTLS, or something later. Each transition is one log line so
 * the export is searchable per data conn.
 *
 * The underlying RTCPeerConnection is a non-public peerjs internal, we
 * cast through unknown to read it. Best-effort: if peerjs ever changes
 * shape we just lose the diagnostics rather than crashing.
 */
const ICE_DISCONNECT_GRACE_MS = 4_000;

export function attachIceDiagnostics(
  conn: DataConnection,
  onDead?: () => void,
): void {
  const pc = (conn as DataConnection & { peerConnection?: RTCPeerConnection })
    .peerConnection;
  if (!pc) {
    iceLog.debug("no underlying peerConnection: skipping ICE diagnostics", {
      peerId: conn.peer,
    });
    return;
  }
  // Liveness state-machine: when the host refreshes, its peer is destroyed
  // abruptly on pagehide and the station's RTCPeerConnection can go silent
  // WITHOUT peerjs ever firing `close`/`error`. We watch the ICE / PC state
  // directly and call onDead() so the reconnect loop starts anyway.
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  const clearGrace = () => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };
  const fireDead = (why: string) => {
    if (dead) return; // at most once per dead connection
    dead = true;
    clearGrace();
    iceLog.debug(`connection dead (${why}): signalling onDead`, {
      peerId: conn.peer,
    });
    onDead?.();
  };
  const ctx = { peerId: conn.peer };
  iceLog.debug("attached", {
    ...ctx,
    initial: {
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState,
    },
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    iceLog.debug(`iceConnectionState=${pc.iceConnectionState}`, ctx);
    const state = pc.iceConnectionState;
    if (state === "failed" || state === "closed") {
      // Terminal: no recovery from these.
      fireDead(`iceConnectionState=${state}`);
    } else if (state === "disconnected") {
      // Possibly transient (a brief network blip recovers to `connected`).
      // Start a grace timer; only declare dead if we're still not healthy
      // when it elapses.
      if (!dead && graceTimer === null) {
        graceTimer = setTimeout(() => {
          graceTimer = null;
          const s = pc.iceConnectionState;
          if (s !== "connected" && s !== "completed") {
            fireDead("iceConnectionState=disconnected (grace elapsed)");
          }
        }, ICE_DISCONNECT_GRACE_MS);
      }
    } else if (state === "connected" || state === "completed") {
      // Recovered (or healthy): cancel any pending dead-declaration.
      clearGrace();
    }
  });
  pc.addEventListener("icegatheringstatechange", () => {
    iceLog.debug(`iceGatheringState=${pc.iceGatheringState}`, ctx);
  });
  pc.addEventListener("connectionstatechange", () => {
    iceLog.debug(`connectionState=${pc.connectionState}`, ctx);
    if (pc.connectionState === "failed") {
      fireDead("connectionState=failed");
    }
  });
  pc.addEventListener("signalingstatechange", () => {
    iceLog.debug(`signalingState=${pc.signalingState}`, ctx);
  });
  pc.addEventListener("icecandidate", (ev) => {
    const c = ev.candidate;
    if (!c) {
      iceLog.debug("icecandidate: end-of-candidates", ctx);
      return;
    }
    // Strip the raw `candidate` SDP string to keep the entry compact,
    // type, protocol, and address class are the diagnostic-grade fields.
    iceLog.debug("icecandidate", {
      ...ctx,
      type: c.type,
      protocol: c.protocol,
      // address may be a .local mDNS hostname (Chrome / iOS Safari
      // privacy default) or a real IP. The shape tells us whether the
      // browser is publishing host candidates the other side can use.
      address: c.address,
      port: c.port,
      relatedAddress: c.relatedAddress,
    });
  });
  pc.addEventListener("icecandidateerror", (ev) => {
    const e = ev as RTCPeerConnectionIceErrorEvent;
    iceLog.warn("icecandidateerror", {
      ...ctx,
      url: e.url,
      errorCode: e.errorCode,
      errorText: e.errorText,
    });
  });
  // Clean teardown (peerjs `close`, or our own reconnect tearing the conn
  // down): stop reacting and kill any pending grace timer so a stale timer
  // can't fire onDead after the connection is already gone. Mark dead so
  // any late state transition is ignored too.
  conn.on("close", () => {
    dead = true;
    clearGrace();
  });
}
