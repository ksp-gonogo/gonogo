import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { PortMappingStatus } from "./portMapper.js";

/** The part of a PortMapper the switch drives. */
export interface ForwardingMapper {
  readonly status: PortMappingStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Whether to forward, the router to ask, and the computer it forwards to. */
export interface ForwardingChoice {
  enabled: boolean;
  /** The router's address as the player gave it; nothing is asked without one. */
  router: string | null;
  /** This computer's address as the player gave it, which a UPnP router forwards to. */
  lan: string | null;
}

const NO_ADDRESS: PortMappingStatus = {
  state: "no-address",
  message: "Automatic port forwarding needs your router's address.",
};

/*
 * The relay speaks NAT-PMP, which is IPv4 only, and UPnP's IPv4 port mapping
 * (WANIPConnection AddPortMapping). Opening an IPv6 pinhole needs PCP or UPnP's
 * WANIPv6FirewallControl, neither of which it speaks.
 */
const IPV6_UNSUPPORTED: PortMappingStatus = {
  state: "ipv6-unsupported",
  message: "Gonogo cannot ask a router to open a port over IPv6 yet.",
};

/** Whether `text` is an IPv4 or IPv6 address, a link-local one with its zone included. */
export function isIpAddress(text: string): boolean {
  return isIP(text) !== 0;
}

function usesIpv6(choice: ForwardingChoice): boolean {
  return isIP(choice.router ?? "") === 6 || isIP(choice.lan ?? "") === 6;
}

/**
 * Automatic port forwarding as a switch: on with a router address, the relay
 * asks that router to open its port and keeps it open; off, it closes it. It
 * starts from `GONOGO_AUTO_PORT_FORWARD`, `ROUTER_IP` and `LAN_IP`, and the
 * main screen's "Automatic port forwarding" settings change all three while
 * the relay runs. Changes are applied one at a time, in the order they arrive.
 */
export class PortForwarding {
  private mapper: ForwardingMapper | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly make: (
      router: string,
      lan: string | null,
    ) => ForwardingMapper,
    private choice: ForwardingChoice,
    private readonly onLanChange?: (lan: string | null) => void,
  ) {}

  get enabled(): boolean {
    return this.choice.enabled;
  }

  get router(): string | null {
    return this.choice.router;
  }

  get lan(): string | null {
    return this.choice.lan;
  }

  /** Where the router forward stands, or null while forwarding is off. */
  get status(): PortMappingStatus | null {
    if (!this.choice.enabled) return null;
    if (this.choice.router && usesIpv6(this.choice)) return IPV6_UNSUPPORTED;
    return this.mapper?.status ?? NO_ADDRESS;
  }

  start(): Promise<void> {
    return this.apply(() => this.open());
  }

  set(next: ForwardingChoice): Promise<void> {
    return this.apply(async () => {
      const same =
        next.enabled === this.choice.enabled &&
        next.router === this.choice.router &&
        next.lan === this.choice.lan;
      if (same) return;
      const lanChanged = next.lan !== this.choice.lan;
      this.choice = next;
      if (lanChanged) this.onLanChange?.(next.lan);
      await this.close();
      await this.open();
    });
  }

  stop(): Promise<void> {
    return this.apply(() => this.close());
  }

  private apply(step: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(step, step);
    return this.queue;
  }

  private async open(): Promise<void> {
    const { enabled, router, lan } = this.choice;
    if (!enabled || !router || this.mapper || usesIpv6(this.choice)) return;
    const mapper = this.make(router, lan);
    this.mapper = mapper;
    await mapper.start();
  }

  private async close(): Promise<void> {
    const mapper = this.mapper;
    this.mapper = null;
    await mapper?.stop();
  }
}

/**
 * Mount `GET /port-forward` (the switch, both addresses and where the forward
 * stands) and `POST /port-forward` (`{ enabled: boolean, routerIp?: string,
 * lanIp?: string }`, from the main screen). A post without an address keeps
 * the one the relay already has. Which pages may reach them is the
 * relay-wide `registerAppOrigins` gate.
 */
export function registerPortForwardRoutes(
  fastify: FastifyInstance,
  forwarding: PortForwarding,
): void {
  const body = () => ({
    enabled: forwarding.enabled,
    routerIp: forwarding.router,
    lanIp: forwarding.lan,
    portMapping: forwarding.status,
  });
  fastify.get("/port-forward", async () => body());
  fastify.post("/port-forward", async (req, reply) => {
    const field = (key: string): unknown =>
      typeof req.body === "object" && req.body !== null
        ? Reflect.get(req.body, key)
        : undefined;
    const enabled = field("enabled");
    const sent = field("routerIp");
    const sentLan = field("lanIp");
    if (typeof enabled !== "boolean") {
      return reply.status(400).send({ error: "enabled must be true or false" });
    }
    const bad = (v: unknown) =>
      v !== undefined && (typeof v !== "string" || !isIpAddress(v));
    if (bad(sentLan)) {
      return reply.status(400).send({ error: "lanIp must be an IP address" });
    }
    if (bad(sent)) {
      return reply
        .status(400)
        .send({ error: "routerIp must be an IP address" });
    }
    // A post without an address keeps the one the relay has, which may be `ROUTER_IP` or `LAN_IP`.
    await forwarding.set({
      enabled,
      router: typeof sent === "string" ? sent : forwarding.router,
      lan: typeof sentLan === "string" ? sentLan : forwarding.lan,
    });
    return body();
  });
}
