import type { FastifyInstance } from "fastify";
import type { PortMappingStatus } from "./portMapper.js";

/** The part of a PortMapper the switch drives. */
export interface ForwardingMapper {
  readonly status: PortMappingStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Automatic port forwarding as a switch: on, the relay asks the router to
 * open its port and keeps it open; off, it closes it. It starts from
 * `GONOGO_AUTO_PORT_FORWARD` and the main screen's "Automatic port
 * forwarding" setting changes it while the relay runs. Changes are applied
 * one at a time, in the order they arrive.
 */
export class PortForwarding {
  private mapper: ForwardingMapper | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly make: () => ForwardingMapper,
    private on: boolean,
  ) {}

  get enabled(): boolean {
    return this.on;
  }

  /** Where the router forward stands, or null while forwarding is off. */
  get status(): PortMappingStatus | null {
    return this.mapper?.status ?? null;
  }

  start(): Promise<void> {
    return this.apply(() => (this.on ? this.open() : Promise.resolve()));
  }

  set(enabled: boolean): Promise<void> {
    return this.apply(async () => {
      if (enabled === this.on) return;
      this.on = enabled;
      await (enabled ? this.open() : this.close());
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
    if (this.mapper) return;
    const mapper = this.make();
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
 * Mount `GET /port-forward` (the switch and where the forward stands) and
 * `POST /port-forward` (`{ enabled: boolean }`, from the main screen). Which
 * pages may reach them is the relay-wide `registerAppOrigins` gate.
 */
export function registerPortForwardRoutes(
  fastify: FastifyInstance,
  forwarding: PortForwarding,
): void {
  const body = () => ({
    enabled: forwarding.enabled,
    portMapping: forwarding.status,
  });
  fastify.get("/port-forward", async () => body());
  fastify.post("/port-forward", async (req, reply) => {
    const enabled: unknown =
      typeof req.body === "object" && req.body !== null
        ? Reflect.get(req.body, "enabled")
        : undefined;
    if (typeof enabled !== "boolean") {
      return reply.status(400).send({ error: "enabled must be true or false" });
    }
    await forwarding.set(enabled);
    return body();
  });
}
