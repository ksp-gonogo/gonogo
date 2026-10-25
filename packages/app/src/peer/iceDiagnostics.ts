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
    switch (state) {
      case "failed":
      case "closed":
        // Terminal: no recovery from these.
        fireDead(`iceConnectionState=${state}`);
        break;
      case "disconnected":
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
        break;
      case "connected":
      case "completed":
        // Recovered (or healthy): cancel any pending dead-declaration.
        clearGrace();
        break;
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
    /* The address itself never leaves the browser: a server-reflexive
       candidate carries the player's public IP. Its class is what a diagnosis
       needs, since that says whether the browser is publishing host
       candidates the other side can use. */
    iceLog.debug("icecandidate", {
      ...ctx,
      type: c.type,
      protocol: c.protocol,
      addressClass: iceAddressClass(c.address),
      port: c.port,
      relatedAddressClass: iceAddressClass(c.relatedAddress),
    });
  });
  pc.addEventListener("icecandidateerror", (ev) => {
    const e = ev as RTCPeerConnectionIceErrorEvent;
    iceLog.warn("icecandidateerror", {
      ...ctx,
      ...iceServerUrlParts(e.url),
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

/**
 * The scheme, address class and port of an ICE server URL, never the address:
 * a relay addressed by a public IP would otherwise ship it to the log.
 */
export function iceServerUrlParts(url: string | null | undefined): {
  serverScheme: string;
  serverAddressClass: IceAddressClass;
  serverPort: number | null;
} {
  const m = /^(stuns?|turns?):(\[[^\]]*\]|[^:/?]*)(?::(\d+))?/i.exec(url ?? "");
  return {
    serverScheme: m?.[1].toLowerCase() ?? "unknown",
    serverAddressClass: iceAddressClass(m?.[2]),
    serverPort: m?.[3] ? Number(m[3]) : null,
  };
}

export type IceAddressClass =
  | "none"
  | "mdns"
  | "loopback"
  | "private"
  | "public"
  | "hostname";

/**
 * Which kind of address an ICE candidate carries, without the address: a
 * `.local` mDNS name, a loopback, a private or link-local range, or a public
 * address. `none` when the candidate has no address.
 */
export function iceAddressClass(
  address: string | null | undefined,
): IceAddressClass {
  if (!address) return "none";
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.endsWith(".local")) return "mdns";
  if (a.includes(":")) {
    if (a === "::1") return "loopback";
    // Unique local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a)) return "private";
    return "public";
  }
  const octets = a.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) {
    return "hostname";
  }
  const [first, second] = octets;
  if (first === 127) return "loopback";
  if (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  ) {
    return "private";
  }
  return "public";
}
