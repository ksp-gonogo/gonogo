import type { FastifyInstance } from "fastify";
import type { EndpointHandle } from "./endpointManager.js";
import type { PortMappingStatus } from "./portMapper.js";

export interface HealthRoutesOptions {
  /** The station endpoint, or null when none was started. */
  getEndpoint: () => EndpointHandle | null;
  /** Why the endpoint is not up yet but will be retried, or null. While set, the relay itself is healthy. */
  getPendingReason?: () => string | null;
  /** True when this relay is meant to run the endpoint (`SKIP_ENDPOINT` unset), so a dead one is a fault. */
  endpointExpected: boolean;
  /** Where the relay's attempt to open its port on the router stands, or null when it makes none. */
  getPortMapping?: () => PortMappingStatus | null;
}

/**
 * Mount `/health`: 200 with the endpoint's port and public address while it
 * runs, 200 with `endpoint: null` and the reason while it waits for a public
 * address (a home network needs no endpoint to work), and 503 when it should
 * be running and has stopped.
 */
export function registerHealthRoutes(
  fastify: FastifyInstance,
  {
    getEndpoint,
    getPendingReason,
    endpointExpected,
    getPortMapping,
  }: HealthRoutesOptions,
): void {
  fastify.get("/health", async (_req, reply) => {
    const mapping = getPortMapping?.() ?? null;
    const extra = mapping ? { portMapping: mapping } : {};
    const handle = getEndpoint();
    if (handle?.running()) {
      return {
        status: "ok",
        endpoint: { port: handle.port, publicIp: handle.publicIp },
        ...extra,
      };
    }
    const pending = getPendingReason?.() ?? null;
    if (pending) {
      return {
        status: "ok",
        endpoint: null,
        endpointUnavailable: pending,
        ...extra,
      };
    }
    if (endpointExpected) {
      return reply
        .status(503)
        .send({ status: "endpoint-down", endpoint: null });
    }
    return { status: "ok", endpoint: null, ...extra };
  });
}
