import { logger } from "@gonogo/logger";
import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";

// Tagged logger for the kOS bridge surface — lets operators filter
// "all kOS-bridge traffic" in Axiom independent of the proxy's other
// log lines. Mirrors how the browser side tags peer:ice / camera /
// peer:stream.
const kosLog = logger.tag("kos-bridge");

export interface BridgeOptions {
  kosHost?: string;
  kosPort?: number;
}

// Active PTY sessions, keyed by client-supplied session ID.
const sessions = new Map<string, pty.IPty>();

export function registerKosBridge(
  fastify: FastifyInstance,
  { kosHost = "localhost", kosPort = 5410 }: BridgeOptions = {},
): void {
  // ---------------------------------------------------------------------------
  // WebSocket ↔ PTY bridge
  // ---------------------------------------------------------------------------
  fastify.get("/kos", { websocket: true }, (socket, request) => {
    const params = request.query as Record<string, string>;
    const host = params.host ?? kosHost;
    const port =
      params.port === undefined ? kosPort : Number.parseInt(params.port, 10);
    const id = params.id ?? crypto.randomUUID();
    const cols =
      params.cols === undefined ? 80 : Number.parseInt(params.cols, 10);
    const rows =
      params.rows === undefined ? 24 : Number.parseInt(params.rows, 10);

    request.log.info({ host, port, id, cols, rows }, "spawning telnet session");
    kosLog.info("spawning telnet session", { host, port, id, cols, rows });

    const term = pty.spawn("telnet", [host, String(port)], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? "/",
      env: process.env as Record<string, string>,
    });

    sessions.set(id, term);
    request.log.info({ id, pid: term.pid }, "telnet PTY spawned");
    kosLog.info("telnet PTY spawned", { id, pid: term.pid });

    // PTY → browser
    term.onData((data) => {
      try {
        socket.send(data);
      } catch {
        // WS may have closed between the data arriving and the send
      }
    });

    // PTY exit → close WS
    term.onExit(({ exitCode }) => {
      sessions.delete(id);
      request.log.info({ id, exitCode }, "telnet PTY exited");
      kosLog.info("telnet PTY exited", { id, exitCode });
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    });

    // Browser → PTY (with a brief hold after connect to let the telnet NAWS
    // exchange settle — kOS reports "Garbled input" if user input races with
    // the window-size negotiation that fires on terminal resize at mount time)
    const INPUT_HOLD_MS = 300;
    let inputReady = false;
    const inputQueue: string[] = [];
    const holdTimer = setTimeout(() => {
      inputReady = true;
      for (const data of inputQueue) term.write(data);
      inputQueue.length = 0;
    }, INPUT_HOLD_MS);

    socket.on("message", (raw: Buffer | string) => {
      const data = typeof raw === "string" ? raw : raw.toString("binary");
      if (inputReady) {
        term.write(data);
      } else {
        inputQueue.push(data);
      }
    });

    // WS close → kill PTY
    socket.on("close", () => {
      clearTimeout(holdTimer);
      sessions.delete(id);
      request.log.info({ id }, "WS closed — killing PTY");
      kosLog.info("WS closed — killing PTY", { id });
      try {
        term.kill();
      } catch {
        /* already dead */
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Resize endpoint  POST /kos/resize  { id, cols, rows }
  // ---------------------------------------------------------------------------
  fastify.post("/kos/resize", async (request, reply) => {
    const { id, cols, rows } = request.body as {
      id: string;
      cols: number;
      rows: number;
    };

    if (
      typeof id !== "string" ||
      typeof cols !== "number" ||
      typeof rows !== "number"
    ) {
      return reply
        .status(400)
        .send({ error: "id (string), cols (number), rows (number) required" });
    }

    const term = sessions.get(id);
    if (!term) {
      return reply.status(404).send({ error: "session not found" });
    }

    term.resize(cols, rows);
    return reply.status(204).send();
  });
}
