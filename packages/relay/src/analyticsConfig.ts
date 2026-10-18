import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Relay-as-config-broker for the operator's technical-analytics consent.
 *
 * The host POSTs its consent (`{ enabled }`) on every change and re-asserts
 * it on its registry heartbeat. The relay holds the current value in memory
 * (defaulting to disabled until the first post, privacy-first) and fans it
 * out to the services that can't reach the host directly:
 *
 *   - `GET  /analytics-config`        , pull the current value.
 *   - `GET  /analytics-config/stream` , Server-Sent Events: the current
 *                                        value on subscribe, then every
 *                                        change, for any service that wants
 *                                        to gate its own Axiom sink on it.
 *   - `POST /analytics-config`        : host pushes `{ enabled: boolean,
 *                                        runId?: string }`, the run being
 *                                        the analytics run the relay stamps
 *                                        on its own entries.
 *
 * In-memory only, single-instance assumption: same as the host registry.
 * A relay restart resets to disabled; the host's heartbeat re-POST re-learns
 * the real value within one beat.
 */

export interface AnalyticsConfigController {
  /** Current consent. Defaults false until the first post. */
  get(): boolean;
  /** Update the consent and notify SSE subscribers. */
  set(enabled: boolean): void;
  /** Subscribe to changes (does not fire on subscribe). Returns unsubscribe. */
  subscribe(cb: (enabled: boolean) => void): () => void;
  /** Live SSE subscriber count: for tests. */
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
  hostId?: unknown;
  runId?: unknown;
}

/** The shape the main screen mints run ids in, and nothing longer, since the relay stamps it on every entry unmasked. */
const RUN_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** How long a host that has stopped posting keeps the say; four missed 30 s heartbeats. */
const HOST_SILENT_MS = 120_000;

/** A host's stable identity, its share code. */
const HOST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function writeSseEvent(reply: FastifyReply, enabled: boolean): void {
  reply.raw.write(`data: ${JSON.stringify({ enabled })}\n\n`);
}

/**
 * Mount the analytics-config broker onto a Fastify instance. Which pages
 * may reach it is the relay-wide `registerAppOrigins` gate, the same one
 * `/ice-config` sits behind. Optionally takes a callback fired
 * on every change so the relay can gate its own Axiom transport.
 *
 * Returns the controller so the caller can read/gate and tests can inspect.
 */
export function registerAnalyticsConfigRoutes(
  fastify: FastifyInstance,
  opts: {
    controller?: AnalyticsConfigController;
    onChange?: (enabled: boolean) => void;
    /** Called each time the host sends its consent, before it is applied, with the run the host named or `undefined`. */
    onRunId?: (runId: string | undefined) => void;
    /** Clock, for tests. */
    now?: () => number;
  } = {},
): AnalyticsConfigController {
  const controller = opts.controller ?? new InMemoryAnalyticsConfig();
  const now = opts.now ?? Date.now;
  // Consent is one host's choice. The first host to post owns it, and a post naming any other host is refused until the owner has been silent for HOST_SILENT_MS, so a second page (a station, another browser profile) cannot move it.
  let owner: { hostId: string; lastSeen: number } | undefined;

  if (opts.onChange) {
    const onChange = opts.onChange;
    controller.subscribe(onChange);
    // Apply the initial (default-disabled) state once so the relay's own gate starts in the right place even before the first POST.
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
    if (typeof body.hostId !== "string" || !HOST_ID_PATTERN.test(body.hostId)) {
      return reply.status(400).send({ error: "hostId is required" });
    }
    const t = now();
    if (
      owner &&
      owner.hostId !== body.hostId &&
      t - owner.lastSeen < HOST_SILENT_MS
    ) {
      return reply
        .status(409)
        .send({ error: "analytics consent belongs to another host" });
    }
    owner = { hostId: body.hostId, lastSeen: t };
    const runId =
      body.enabled &&
      typeof body.runId === "string" &&
      RUN_ID_PATTERN.test(body.runId)
        ? body.runId
        : undefined;
    opts.onRunId?.(runId);
    controller.set(body.enabled);
    return { ok: true, enabled: controller.get() };
  });

  fastify.get("/analytics-config/stream", (req, reply) => {
    // Take manual control of the response so we can keep it open and stream
    // SSE frames. Fastify won't manage a long-lived stream for us.
    reply.hijack();
    // hijack() bypasses the onSend hook @fastify/cors adds its header in, so it is echoed here; a foreign origin was already refused in onRequest.
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...(origin
        ? { "access-control-allow-origin": origin, vary: "Origin" }
        : {}),
    });

    // Push the current value immediately so a subscriber gates correctly without waiting for the next change.
    writeSseEvent(reply, controller.get());

    const unsub = controller.subscribe((enabled) => {
      writeSseEvent(reply, enabled);
    });

    // Tear down the subscription when the client disconnects, or the listener Set leaks one entry per dropped connection.
    req.raw.on("close", () => {
      unsub();
    });
  });

  return controller;
}
