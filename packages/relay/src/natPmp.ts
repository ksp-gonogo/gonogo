import { createSocket } from "node:dgram";

export const NAT_PMP_PORT = 5351;

/** NAT-PMP result codes (RFC 6886 section 3.5) a router answers with. */
const RESULT_TEXT: Record<number, string> = {
  1: "the router does not support this request",
  2: "the router refused it",
  3: "the router's network is down",
  4: "the router is out of mappings",
  5: "the router does not allow this protocol",
};

export class NatPmpRefused extends Error {
  constructor(readonly code: number) {
    super(RESULT_TEXT[code] ?? `the router answered with code ${code}`);
  }
}

export interface NatPmpTarget {
  gateway: string;
  /** The router's NAT-PMP port; only a test stands in a different one. */
  port?: number;
  /** How long each attempt waits for an answer. */
  timeoutMs: number;
  /** Datagrams sent before giving up, the wait doubling each time. */
  attempts?: number;
}

export type MappingProtocol = "udp" | "tcp";

export interface MappingRequest extends NatPmpTarget {
  protocol: MappingProtocol;
  /** The port on this side the router forwards to. */
  internalPort: number;
  /** The port asked for on the router's public address. */
  externalPort: number;
  lifetimeSeconds: number;
}

export interface Mapping {
  internalPort: number;
  externalPort: number;
  lifetimeSeconds: number;
}

export function encodePublicAddressRequest(): Buffer {
  return Buffer.from([0, 0]);
}

export function encodeMappingRequest(
  protocol: MappingProtocol,
  internalPort: number,
  externalPort: number,
  lifetimeSeconds: number,
): Buffer {
  const out = Buffer.alloc(12);
  out.writeUInt8(0, 0);
  out.writeUInt8(protocol === "udp" ? 1 : 2, 1);
  out.writeUInt16BE(internalPort, 4);
  out.writeUInt16BE(externalPort, 6);
  out.writeUInt32BE(lifetimeSeconds, 8);
  return out;
}

/** Send one datagram to a router and resolve with the first datagram `accept` takes, or null when every attempt goes unanswered. */
export function exchange<T>(
  target: NatPmpTarget,
  request: Buffer,
  accept: (msg: Buffer) => T | null,
): Promise<T | null> {
  const port = target.port ?? NAT_PMP_PORT;
  const attempts = target.attempts ?? 2;
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      socket.close();
      settle();
    };
    const send = () => {
      if (attempt >= attempts) return finish(() => resolve(null));
      const wait = target.timeoutMs * 2 ** attempt;
      attempt++;
      socket.send(request, port, target.gateway, (err) => {
        if (err) finish(() => reject(err));
      });
      timer = setTimeout(send, wait);
    };
    socket.on("error", (err) => finish(() => reject(err)));
    socket.on("message", (msg, rinfo) => {
      if (rinfo.address !== target.gateway) return;
      let parsed: T | null;
      try {
        parsed = accept(msg);
      } catch (err) {
        return finish(() => reject(err));
      }
      if (parsed !== null) finish(() => resolve(parsed));
    });
    send();
  });
}

/**
 * Ask a router for its public address. Resolves with the address, or null when
 * nothing answers NAT-PMP there; rejects with {@link NatPmpRefused} when
 * something answers and says no.
 */
export function requestPublicAddress(
  target: NatPmpTarget,
): Promise<string | null> {
  return exchange(target, encodePublicAddressRequest(), (msg) => {
    if (msg.length < 12 || msg[0] !== 0 || msg[1] !== 128) return null;
    const result = msg.readUInt16BE(2);
    if (result !== 0) throw new NatPmpRefused(result);
    return [msg[8], msg[9], msg[10], msg[11]].join(".");
  });
}

/**
 * Ask a router to forward a port to this machine. A lifetime of 0 with an
 * external port of 0 deletes the mapping. Resolves null when nothing answers.
 */
export function requestMapping(req: MappingRequest): Promise<Mapping | null> {
  return exchange(
    req,
    encodeMappingRequest(
      req.protocol,
      req.internalPort,
      req.externalPort,
      req.lifetimeSeconds,
    ),
    (msg) => {
      if (
        msg.length < 16 ||
        msg[0] !== 0 ||
        msg[1] !== (req.protocol === "udp" ? 129 : 130)
      )
        return null;
      if (msg.readUInt16BE(8) !== req.internalPort) return null;
      const result = msg.readUInt16BE(2);
      if (result !== 0) throw new NatPmpRefused(result);
      return {
        internalPort: msg.readUInt16BE(8),
        externalPort: msg.readUInt16BE(10),
        lifetimeSeconds: msg.readUInt32BE(12),
      };
    },
  );
}
