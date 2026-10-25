import { readFileSync } from "node:fs";
import {
  type MappingProtocol,
  NatPmpRefused,
  requestMapping,
  requestPublicAddress,
} from "./natPmp.js";
import { answersPcpOrUpnp } from "./otherProtocols.js";
import {
  addPortMapping,
  deletePortMapping,
  discoverIgd,
  type Igd,
  localAddressToward,
  type UpnpTarget,
} from "./upnp.js";

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
  /** Addresses asked only when none of `gateways` answers, all at once and cheap enough to cover a whole range. */
  sweep?: readonly string[];
  /** Every port to open, each mapped to the same port number on this computer. */
  ports: readonly MappedPort[];
  /** Seconds a mapping lasts before the router drops it; renewed at half. */
  leaseSeconds?: number;
  timeoutMs?: number;
  /** The router's NAT-PMP port; only a test stands in a different one. */
  natPmpPort?: number;
  /** Look for a router that speaks PCP or UPnP only; replaced by a test. */
  probeOthers?: (gateway: string) => Promise<"pcp" | "upnp" | null>;
  /** The address of this machine on the router's network, which a UPnP mapping names as its target. Found from the route to the router when unset. */
  lanIp?: string | null;
  /** The router's discovery port; only a test stands in a different one. */
  ssdpPort?: number;
  /** Replaced by a test; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

const PROBE_BATCH = 128;
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
  [192, 168, 86, 1],
  [192, 168, 50, 1],
  [192, 168, 3, 1],
  [10, 1, 1, 1],
].map((octets) => octets.join("."));

const STATUS: Record<PortMappingState, string> = {
  checking: "Asking your router to open the relay's port...",
  mapped: "Your router opened the relay's port.",
  refused: "Your router refused to open the relay's port",
  "no-answer": "Your router did not answer a request to open the relay's port.",
  "container-only":
    "Your router only opens ports for a program running directly on this computer, so the relay could not open it from inside the container.",
};

const MANUAL = "Forward it by hand, as the networking guide describes.";

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

/**
 * Every `.1` and `.254` address of the 192.168 networks, which is where home
 * routers sit. Each is asked for a mapping-protocol answer, so only a real
 * router is ever used.
 */
export function sweepCandidates(): string[] {
  const out: string[] = [];
  for (let n = 0; n < 256; n++) {
    out.push(`192.168.${n}.1`, `192.168.${n}.254`);
  }
  return out;
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

/** One port the relay asks the router to open. */
export interface MappedPort {
  protocol: MappingProtocol;
  port: number;
}

type Held = MappedPort;

/** The endpoint's one port, on UDP for stations and TCP for networks that block UDP. */
export function endpointPorts(port: number): MappedPort[] {
  return [
    { protocol: "udp", port },
    { protocol: "tcp", port },
  ];
}

type Outcome =
  | { ok: true }
  | { ok: false; state: PortMappingState; reason: string };

/** One way of asking the router, chosen by whichever protocol it answered. */
interface Backend {
  map(held: Held, leaseSeconds: number): Promise<Outcome>;
  release(held: Held): Promise<void>;
}

/**
 * Opens the relay's ports on the home router with NAT-PMP, or with UPnP when
 * the router does not answer NAT-PMP, renews them before the lease ends and
 * deletes them on stop. The request goes straight to the router, so it works
 * from inside a container: a NAT-PMP mapping goes to the address the request
 * arrives from, which is the player's computer once the container network's
 * own translation has rewritten the source, while a UPnP mapping names that
 * address in the request, taken from `lanIp`. The internal port in each
 * request is the port the container publishes, so the host's port publishing
 * carries the traffic the rest of the way.
 */
export class PortMapper {
  private current: PortMappingStatus = {
    state: "checking",
    message: STATUS.checking,
  };
  private backend: Backend | null = null;
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

  private set(state: PortMappingState, detail?: string): void {
    const message =
      state === "mapped" || state === "checking"
        ? STATUS[state]
        : state === "refused"
          ? `${STATUS.refused}${detail ? ` (${detail})` : ""}. ${MANUAL}`
          : `${STATUS[state]} ${MANUAL}`;
    this.current = { state, message };
  }

  /** Ask every address in `stage` at once, in batches, and return the first by position that answers. */
  private async firstAnswer<T>(
    stage: readonly string[],
    probe: (gateway: string) => Promise<T | null>,
  ): Promise<{ gateway: string; value: T } | null> {
    for (let from = 0; from < stage.length; from += PROBE_BATCH) {
      const batch = stage.slice(from, from + PROBE_BATCH);
      const answers = await Promise.all(
        batch.map((gateway) => probe(gateway).catch(() => null)),
      );
      const at = answers.findIndex((a) => a !== null);
      if (at >= 0)
        return { gateway: batch[at] as string, value: answers[at] as T };
    }
    return null;
  }

  private async natPmpAnswers(gateway: string): Promise<string | null> {
    try {
      return await requestPublicAddress(this.target(gateway));
    } catch (err) {
      return err instanceof NatPmpRefused ? "" : null;
    }
  }

  /** Find the router, open every port and schedule renewals. Resolves once the first attempt has an outcome. */
  async start(): Promise<void> {
    const log = this.opts.log ?? (() => {});
    const stages = [this.opts.gateways, this.opts.sweep ?? []].filter(
      (stage) => stage.length > 0,
    );
    for (const stage of stages) {
      const nat = await this.firstAnswer(stage, (g) => this.natPmpAnswers(g));
      if (nat) {
        this.backend = this.natPmpBackend(nat.gateway);
        log(`router at ${nat.gateway} answered NAT-PMP`);
        await this.mapAll();
        return;
      }
      const upnp = await this.firstAnswer(stage, (g) =>
        discoverIgd(this.upnpTarget(g)),
      );
      if (upnp) {
        log(
          `router at ${upnp.gateway} answered UPnP (${upnp.value.server || "no server string"})`,
        );
        this.backend = await this.upnpBackend(
          this.upnpTarget(upnp.gateway),
          upnp.value,
        );
        await this.mapAll();
        return;
      }
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
    const asked = this.opts.gateways.join(", ") || "no address";
    const swept = this.opts.sweep?.length
      ? ` and ${this.opts.sweep.length} usual router addresses`
      : "";
    log(
      `no router answered NAT-PMP or UPnP at ${asked}${swept}; set ROUTER_IP to the router's address (and LAN_IP to this computer's address on that network) to name them`,
    );
    this.set("no-answer");
  }

  private upnpTarget(gateway: string): UpnpTarget {
    return {
      gateway,
      ssdpPort: this.opts.ssdpPort,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: this.opts.fetchImpl,
    };
  }

  private natPmpBackend(gateway: string): Backend {
    return {
      map: async (held, lease) => {
        try {
          const got = await requestMapping({
            ...this.target(gateway),
            protocol: held.protocol,
            internalPort: held.port,
            externalPort: held.port,
            lifetimeSeconds: lease,
          });
          if (!got) return { ok: false, state: "no-answer", reason: "" };
          if (got.externalPort !== held.port) {
            await this.natPmpBackend(gateway).release(held);
            return {
              ok: false,
              state: "refused",
              reason: `it offered port ${got.externalPort} for ${held.port}`,
            };
          }
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            state: "refused",
            reason: err instanceof NatPmpRefused ? err.message : String(err),
          };
        }
      },
      release: async (held) => {
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
      },
    };
  }

  private async upnpBackend(target: UpnpTarget, igd: Igd): Promise<Backend> {
    const internalClient =
      this.opts.lanIp || (await localAddressToward(target.gateway)) || "";
    const hint = this.opts.lanIp
      ? ""
      : `, the router was given ${internalClient || "no address"} as this computer: set LAN_IP if that is wrong`;
    const protocol = (held: Held) => (held.protocol === "udp" ? "UDP" : "TCP");
    return {
      map: async (held, lease) => {
        try {
          await addPortMapping(target, igd, {
            protocol: protocol(held),
            port: held.port,
            internalClient,
            leaseSeconds: lease,
          });
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            state: "refused",
            reason: `${err instanceof Error ? err.message : String(err)}${hint}`,
          };
        }
      },
      release: async (held) => {
        try {
          await deletePortMapping(target, igd, {
            protocol: protocol(held),
            port: held.port,
          });
        } catch {
          // The lease ends on its own if the router will not take the delete.
        }
      },
    };
  }

  private async mapAll(): Promise<void> {
    const backend = this.backend;
    if (!backend || this.stopped) return;
    const lease = this.opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const log = this.opts.log ?? (() => {});
    let failure: PortMappingState | null = null;
    let reason = "";
    const mapped: Held[] = [];
    for (const held of this.opts.ports) {
      const outcome = await backend.map(held, lease);
      if (!outcome.ok) {
        failure = outcome.state;
        reason = outcome.reason;
        break;
      }
      mapped.push(held);
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

  /** Stop renewing and delete every mapping this mapper holds. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.renewTimer);
    const held = this.held;
    this.held = [];
    for (const port of held) await this.backend?.release(port);
  }
}
