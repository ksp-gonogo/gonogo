import { readFileSync } from "node:fs";
import {
  type MappingProtocol,
  NatPmpRefused,
  requestMapping,
  requestPublicAddress,
} from "./natPmp.js";
import { answersPcpOrUpnp } from "./otherProtocols.js";

export type PortMappingState =
  | "checking"
  | "mapped"
  | "refused"
  | "no-answer"
  | "container-only";

/** What the relay tells the player about opening its ports on the router, in the words shown to them. */
export interface PortMappingStatus {
  state: PortMappingState;
  message: string;
}

export interface PortMapperOptions {
  /** Ordered addresses to ask. The first that answers NAT-PMP is used and the rest are never asked. */
  gateways: readonly string[];
  turnPort: number;
  minPort: number;
  maxPort: number;
  /** Seconds a mapping lasts before the router drops it; renewed at half. */
  leaseSeconds?: number;
  timeoutMs?: number;
  /** The router's NAT-PMP port; only a test stands in a different one. */
  natPmpPort?: number;
  /** Look for a router that speaks PCP or UPnP only; replaced by a test. */
  probeOthers?: (gateway: string) => Promise<"pcp" | "upnp" | null>;
  log?: (message: string) => void;
}

const DEFAULT_LEASE_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 400;

/** Addresses home routers ship on, asked only when no gateway was named or found. */
const COMMON_ROUTER_ADDRESSES = [
  [192, 168, 1, 1],
  [192, 168, 0, 1],
  [10, 0, 0, 1],
  [192, 168, 1, 254],
  [192, 168, 2, 1],
  [192, 168, 178, 1],
  [10, 0, 1, 1],
  [192, 168, 100, 1],
  [192, 168, 8, 1],
  [10, 1, 1, 1],
].map((octets) => octets.join("."));

const STATUS: Record<PortMappingState, string> = {
  checking: "Asking your router to open the relay ports...",
  mapped: "Your router opened the relay ports.",
  refused: "Your router refused to open the relay ports",
  "no-answer": "Your router did not answer a request to open the relay ports.",
  "container-only":
    "Your router only opens ports for a program running directly on this computer, so the relay could not open them from inside the container.",
};

const MANUAL = "Forward them by hand, as the networking guide describes.";

/** The container's default gateway from the Linux routing table, or null where there is none to read. */
export function defaultGateway(
  readRoutes: () => string = () => readFileSync("/proc/net/route", "utf8"),
): string | null {
  let table: string;
  try {
    table = readRoutes();
  } catch {
    return null;
  }
  for (const line of table.split("\n").slice(1)) {
    const [, destination, gateway] = line.split(/\s+/);
    if (destination === "00000000" && gateway && gateway !== "00000000") {
      const b = Buffer.from(gateway, "hex");
      return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
    }
  }
  return null;
}

/** `ROUTER_IP` alone when set, otherwise the default gateway then the usual home router addresses. */
export function gatewayCandidates(
  routerIp: string | null,
  gateway: string | null,
): string[] {
  if (routerIp) return [routerIp];
  return [
    ...new Set([...(gateway ? [gateway] : []), ...COMMON_ROUTER_ADDRESSES]),
  ];
}

interface Held {
  protocol: MappingProtocol;
  port: number;
}

/**
 * Opens the relay's ports on the home router with NAT-PMP, renews them before
 * the lease ends and deletes them on stop. The request goes straight to the
 * router, so it works from inside a container: the router maps to the address
 * the request arrives from, which is the player's computer once the container
 * network's own translation has rewritten the source. The internal port in each
 * request is the port the container publishes, so the host's port publishing
 * carries the traffic the rest of the way.
 */
export class PortMapper {
  private current: PortMappingStatus = {
    state: "checking",
    message: STATUS.checking,
  };
  private gateway: string | null = null;
  private held: Held[] = [];
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly opts: PortMapperOptions) {}

  get status(): PortMappingStatus {
    return this.current;
  }

  private target(gateway: string) {
    return {
      gateway,
      port: this.opts.natPmpPort,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  private ports(): Held[] {
    const { turnPort, minPort, maxPort } = this.opts;
    const session: Held[] = [];
    for (let port = minPort; port <= maxPort; port++) {
      session.push({ protocol: "udp", port });
    }
    return [
      { protocol: "udp", port: turnPort },
      { protocol: "tcp", port: turnPort },
      ...session,
    ];
  }

  private set(state: PortMappingState, detail?: string): void {
    const message =
      state === "mapped" || state === "checking"
        ? STATUS[state]
        : state === "refused"
          ? `${STATUS.refused}${detail ? ` (${detail})` : ""}. ${MANUAL}`
          : `${STATUS[state]} ${MANUAL}`;
    this.current = { state, message };
  }

  /** Find the router, open every port and schedule renewals. Resolves once the first attempt has an outcome. */
  async start(): Promise<void> {
    const log = this.opts.log ?? (() => {});
    for (const gateway of this.opts.gateways) {
      let answered: string | null;
      try {
        answered = await requestPublicAddress(this.target(gateway));
      } catch (err) {
        if (!(err instanceof NatPmpRefused)) continue;
        answered = "";
      }
      if (answered === null) continue;
      this.gateway = gateway;
      log(`router at ${gateway} answered NAT-PMP`);
      await this.mapAll();
      return;
    }
    await this.explainSilence(log);
  }

  private async explainSilence(log: (m: string) => void): Promise<void> {
    const probe = this.opts.probeOthers;
    for (const gateway of this.opts.gateways) {
      const found = probe
        ? await probe(gateway)
        : await answersPcpOrUpnp(this.target(gateway));
      if (found) {
        log(`router at ${gateway} answers ${found} only`);
        this.set("container-only");
        return;
      }
    }
    log("no router answered NAT-PMP");
    this.set("no-answer");
  }

  private async mapAll(): Promise<void> {
    const gateway = this.gateway;
    if (!gateway || this.stopped) return;
    const lease = this.opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const log = this.opts.log ?? (() => {});
    let failure: PortMappingState | null = null;
    let reason = "";
    const mapped: Held[] = [];
    for (const held of this.ports()) {
      try {
        const got = await requestMapping({
          ...this.target(gateway),
          protocol: held.protocol,
          internalPort: held.port,
          externalPort: held.port,
          lifetimeSeconds: lease,
        });
        if (!got) {
          failure = "no-answer";
          break;
        }
        if (got.externalPort !== held.port) {
          await this.release([held]);
          failure = "refused";
          reason = `it offered port ${got.externalPort} for ${held.port}`;
          break;
        }
        mapped.push(held);
      } catch (err) {
        failure = "refused";
        reason = err instanceof NatPmpRefused ? err.message : String(err);
        break;
      }
    }
    this.held = mapped;
    if (failure) {
      log(`port mapping incomplete: ${failure} ${reason}`.trim());
      this.set(failure, reason);
    } else {
      this.set("mapped");
      log(`router mapped ${mapped.length} relay ports`);
    }
    if (!this.stopped) {
      this.renewTimer = setTimeout(
        () => void this.mapAll(),
        failure ? 60_000 : (lease * 1000) / 2,
      );
      this.renewTimer.unref();
    }
  }

  private async release(ports: Held[]): Promise<void> {
    const gateway = this.gateway;
    if (!gateway) return;
    for (const held of ports) {
      try {
        await requestMapping({
          ...this.target(gateway),
          protocol: held.protocol,
          internalPort: held.port,
          externalPort: 0,
          lifetimeSeconds: 0,
        });
      } catch {
        // The lease ends on its own if the router will not take the delete.
      }
    }
  }

  /** Stop renewing and delete every mapping this mapper holds. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.renewTimer);
    const held = this.held;
    this.held = [];
    await this.release(held);
  }
}
