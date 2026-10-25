import { type ChildProcess, spawn } from "node:child_process";
import { createLogRateLimiter } from "./logRateLimit.js";

export interface EndpointOptions {
  /** The gonogo-endpoint binary. */
  binaryPath: string;
  /** The one UDP port, and the same TCP port number, every internet station connects on. */
  port: number;
  /** `host:port` the endpoint serves the main screen's control socket on. */
  control: string;
  /** The router's public address, advertised to stations on other networks. */
  publicIp: string;
  /**
   * This computer's address on the home network. Inside a container the
   * endpoint can only see the container's own address, which no station can
   * reach, so a station on the home network needs this one named.
   */
  lanIp: string | null;
  /**
   * Called once when the endpoint stops serving: it exited, or the binary
   * could not be spawned. Not called for a stop the caller asked for.
   */
  onExit?: (reason: string) => void;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface EndpointHandle {
  port: number;
  publicIp: string;
  /** Whether the endpoint process is still there to take a station. */
  running(): boolean;
  stop(): Promise<void>;
}

const LOG_LINES_PER_WINDOW = 20;
const LOG_WINDOW_MS = 10_000;

/** Spawn the endpoint. Returns once the binary is spawned, not once its ports are bound. */
export function startEndpoint(opts: EndpointOptions): EndpointHandle {
  const args = [
    "-port",
    String(opts.port),
    "-control",
    opts.control,
    "-public-ip",
    opts.publicIp,
    ...(opts.lanIp ? ["-lan-ip", opts.lanIp] : []),
  ];
  opts.logger.info(
    `[endpoint] spawning ${opts.binaryPath} on ${opts.port} advertising ${opts.publicIp}${opts.lanIp ? ` and ${opts.lanIp}` : ""}`,
  );
  const proc: ChildProcess = spawn(opts.binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const limiter = createLogRateLimiter(LOG_LINES_PER_WINDOW, LOG_WINDOW_MS);
  const flushTimer = setInterval(() => {
    for (const summary of limiter.flush()) {
      opts.logger.error(`[endpoint] ${summary}`);
    }
  }, LOG_WINDOW_MS);
  flushTimer.unref();

  // Go's log package writes to stderr, so every line is logged at info; a failure reaches the relay as an exit.
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0 && limiter.allow(line)) {
        opts.logger.info(`[endpoint] ${line}`);
      }
    }
  };
  proc.stdout?.on("data", forward);
  proc.stderr?.on("data", forward);

  let running = true;
  let stopping = false;
  const down = (reason: string) => {
    if (!running) return;
    running = false;
    clearInterval(flushTimer);
    for (const summary of limiter.flush()) {
      opts.logger.error(`[endpoint] ${summary}`);
    }
    if (!stopping) opts.onExit?.(reason);
  };
  proc.on("error", (err) => down(`spawn failed: ${err.message}`));
  proc.on("exit", (code, signal) => {
    if (!stopping) {
      opts.logger.error(`[endpoint] exited code=${code} signal=${signal}`);
    }
    down(`exited code=${code} signal=${signal}`);
  });

  return {
    port: opts.port,
    publicIp: opts.publicIp,
    running: () => running,
    async stop(): Promise<void> {
      stopping = true;
      if (!running || proc.exitCode !== null) {
        running = false;
        return;
      }
      proc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
          resolve();
        }, 2000);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      running = false;
    },
  };
}
