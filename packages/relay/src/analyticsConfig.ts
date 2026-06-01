import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Relay-as-config-broker for the operator's technical-analytics consent.
 *
 * The host POSTs its consent (`{ enabled }`) on every change and re-asserts
 * it on its registry heartbeat. The relay holds the current value in memory
 * (defaulting to DISABLED until the first POST — privacy-first) and fans it
 * out to the services that can't reach the host directly:
 *
 *   - `GET  /analytics-config`         — pull the current value.
 *   - `GET  /analytics-config/stream`  — Server-Sent Events: the current
 *                                        value on subscribe, then every
 *                                        change. The telnet-proxy subscribes
 *                                        here to gate its own Axiom sink.
 *   - `POST /analytics-config`         — host pushes `{ enabled: boolean }`.
 *
 * In-memory only, single-instance assumption — same as the host registry.
 * A relay restart resets to disabled; the host's heartbeat re-POST re-learns
 * the real value within one beat.
 */

export interface AnalyticsConfigController {
  /** Current consent. Defaults false until the first POST. */
  get(): boolean;
  /** Update the consent and notify SSE subscribers. */
  set(enabled: boolean): void;
  /** Subscribe to changes (does NOT fire on subscribe). Returns unsubscribe. */
  subscribe(cb: (enabled: boolean) => void): () => void;
  /** Live SSE subscriber count — for tests. */
  subscriberCount(): number;
}

class InMemoryAnalyticsConfig implements AnalyticsConfigController {
  private enabled = false;
  private readonly listeners = new Set<(enabled: boolean) => void>();

  get(): boolean {
    return this.enabled;
  }

  set(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    for (const l of this.listeners) l(enabled);
  }

  subscribe(cb: (enabled: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  subscriberCount(): number {
    return this.listeners.size;
  }
}

interface AnalyticsConfigBody {
  enabled?: unknown;
}

function writeSseEvent(reply: FastifyReply, enabled: boolean): void {
  reply.raw.write(`data: ${JSON.stringify({ enabled })}\n\n`);
}

/**
 * Mount the analytics-config broker onto a Fastify instance. CORS is
 * inherited from the relay's global `@fastify/cors` registration (same as
 * `/ice-config` and the host registry). Optionally takes a callback fired
 * on every change so the relay can gate its OWN Axiom transport.
 *
 * Returns the controller so the caller can read/gate and tests can inspect.
 */
export function registerAnalyticsConfigRoutes(
  fastify: FastifyInstance,
  opts: {
    controller?: AnalyticsConfigController;
    onChange?: (enabled: boolean) => void;
  } = {},
): AnalyticsConfigController {
  const controller = opts.controller ?? new InMemoryAnalyticsConfig();

  if (opts.onChange) {
    const onChange = opts.onChange;
    controller.subscribe(onChange);
    // Apply the initial (default-disabled) state once so the relay's own
    // gate starts in the right place even before the first POST.
    onChange(controller.get());
  }

  fastify.get("/analytics-config", async () => ({
    enabled: controller.get(),
  }));

  fastify.post("/analytics-config", async (req, reply) => {
    const body = (req.body ?? {}) as AnalyticsConfigBody;
    if (typeof body.enabled !== "boolean") {
      return reply.status(400).send({ error: "enabled (boolean) is required" });
    }
    controller.set(body.enabled);
    return { ok: true, enabled: controller.get() };
  });

  fastify.get("/analytics-config/stream", (req, reply) => {
    // Take manual control of the response so we can keep it open and stream
    // SSE frames. Fastify won't manage a long-lived stream for us.
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // Echo CORS for the SSE response — hijack() bypasses the onSend hooks
      // @fastify/cors uses, so the header it would normally add is skipped.
      "access-control-allow-origin": "*",
    });

    // Push the current value immediately so a subscriber gates correctly
    // without waiting for the next change.
    writeSseEvent(reply, controller.get());

    const unsub = controller.subscribe((enabled) => {
      writeSseEvent(reply, enabled);
    });

    // Tear down the subscription when the client disconnects, or the
    // listener Set leaks one entry per dropped connection.
    req.raw.on("close", () => {
      unsub();
    });
  });

  return controller;
}
