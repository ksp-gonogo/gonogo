import { readFile } from "node:fs/promises";
import websocket from "@fastify/websocket";
import {
  type FlightFixture,
  type FlightReplayDataSource,
  isFlightFixture,
} from "@ksp-gonogo/data/replay";
import Fastify, { type FastifyInstance } from "fastify";
import {
  createFixtureReplayHost,
  parseTelemachusInbound,
  TelemachusReplayService,
} from "./TelemachusReplayService";

export interface ReplayServerOptions {
  fixture: FlightFixture;
  /** Wall-clock playback rate. 1 = real time. Defaults to 1. */
  rate?: number;
  /** Replay tick interval in ms — how often the source advances. Defaults 250. */
  tickMs?: number;
  /** Pino logger config — `true` enables Fastify's default, `false` disables. */
  logger?: boolean;
}

export interface RunningReplayServer {
  fastify: FastifyInstance;
  replay: FlightReplayDataSource;
  /** Stop the timer + close the Fastify instance. */
  stop(): Promise<void>;
}

/**
 * Boot a Fastify server that speaks the Telemachus wire format on
 * `/datalink` (WS) and `/telemachus/datalink` (HTTP, for execute calls).
 * The whole gonogo app can connect to this exactly as it would to a real
 * KSP+Telemachus install — no app changes required.
 *
 * Returns the Fastify instance + the underlying replay source so callers
 * can introspect (e.g. tests) or call `stop()` on shutdown.
 */
export async function createReplayServer(
  opts: ReplayServerOptions,
): Promise<RunningReplayServer> {
  const replay = await createFixtureReplayHost({
    fixture: opts.fixture,
    rate: opts.rate,
    tickMs: opts.tickMs,
  });

  const fastify = Fastify({ logger: opts.logger ?? false });
  await fastify.register(websocket);

  // ── HTTP — execute (`a=<actionKey>`) just records into the replay log.
  // The real Telemachus would mutate game state and the change would echo
  // back via the WS subscription; we have no game state, so we just log.
  fastify.get("/telemachus/datalink", async (req, reply) => {
    const a = (req.query as Record<string, string | undefined>).a;
    if (typeof a === "string") {
      await replay.execute(a);
    }
    // Mirror Telemachus's no-op response (it sets state and the WS carries
    // the echo). Empty body is fine — the app uses `mode: 'no-cors'`.
    reply.code(200).send({ ok: true });
  });

  // ── HTTP — fixture metadata, useful for the dev UI / a future seek bar.
  fastify.get("/replay/info", async () => ({
    flight: opts.fixture.flight,
    duration: opts.fixture.flight.lastSampleAt - opts.fixture.flight.launchedAt,
    chapters: opts.fixture.chapters ?? [],
    now: replay.now(),
  }));

  // ── WS — Telemachus datalink. One service per connection; all share the
  // single replay source.
  fastify.register(async (instance) => {
    instance.get("/datalink", { websocket: true }, (socket) => {
      const service = new TelemachusReplayService({
        replay,
        send: (payload) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(payload));
          }
        },
      });
      socket.on("message", (raw) => {
        const msg = parseTelemachusInbound(raw.toString());
        if (msg) service.applyMessage(msg);
      });
      socket.on("close", () => service.close());
      socket.on("error", () => service.close());
    });
  });

  return {
    fastify,
    replay,
    async stop() {
      replay.disconnect();
      await fastify.close();
    },
  };
}

/**
 * Load a fixture from a JSON file path. Validates with `isFlightFixture`
 * at the boundary so a malformed file fails fast with a clear error
 * instead of producing weird runtime behaviour later.
 */
export async function loadFixtureFile(path: string): Promise<FlightFixture> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  if (!isFlightFixture(parsed)) {
    throw new Error(`File ${path} is not a valid gonogo flight fixture`);
  }
  return parsed;
}
