import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createLogRateLimiter } from "./logRateLimit.js";

/**
 * Manages a coturn child process, generating a fresh shared-secret on
 * every startup and feeding coturn its discovered public IP. Bundling
 * coturn into the proxy container means:
 *
 *   - One container to run; users get turn out of the box without
 *     wiring up an init script or shared volume.
 *   - The shared secret only ever lives in this process's memory; a
 *     restart rotates it automatically.
 *   - The public IP advertised to clients is the one the proxy itself
 *     discovered (or that the operator pinned via env), so coturn's
 *     relay candidates are always a reachable address.
 */

export interface CoturnOptions {
  /** External IP coturn advertises in relay candidates. */
  externalIp: string;
  /**
   * Local, bindable IP coturn should actually open relay sockets on, passed
   * as the `/private` half of coturn's `--external-ip=<public>/<private>`.
   * Needed whenever `externalIp` is a nat / published address that isn't a
   * local interface, the usual container case, without it coturn tries to
   * bind relay sockets on the non-local `externalIp`, fails `EADDRNOTAVAIL`,
   * and every allocation dies with `create_relay_ioa_sockets: no available
   * ports`. Omit only when `externalIp` is itself a local interface.
   */
  localIp?: string;
  /** Realm name. Cosmetic; coturn requires a value. */
  realm?: string;
  /** Listening UDP/TCP port. Defaults to 3478. */
  port?: number;
  /** Min relay port. Defaults to 49160. */
  minPort?: number;
  /**
   * Max relay port. Defaults to 49199: coturn allocates one relay port
   * per active turn session, and a reloaded station leaves its old
   * allocations holding ports until they expire, so the pool needs room
   * beyond the number of live clients. Consumer routers want one
   * port-forward entry per port, which keeps the range small. If your
   * sessions routinely exceed ~20 concurrent TURN-relayed clients, widen it with `TURN_MIN_PORT`/`TURN_MAX_PORT`
   * (see `config.ts`) and widen the matching docker-compose mapping and
   * router forwards to the same window. No source edit is needed.
   */
  maxPort?: number;
  /** Username for static credentials. Defaults to `gonogo`. */
  username?: string;
  /** Existing secret to reuse. Generated if omitted. */
  secret?: string;
  /** Path to the turnserver binary. Defaults to `turnserver`. */
  binaryPath?: string;
  /**
   * Refuse relay allocations toward loopback, private, link-local and shared
   * carrier-range peer addresses. Off by default because a LAN setup (a Steam Deck and a
   * laptop on one network) can legitimately relay between private addresses;
   * turn it on for a relay reachable from the internet, where those ranges
   * are the relay's own private network.
   */
  denyPrivatePeers?: boolean;
  /**
   * Called once when coturn stops serving: it exited, or the binary could not
   * be spawned. Not called for a stop the caller asked for.
   */
  onExit?: (reason: string) => void;
  logger: {
    info: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface CoturnHandle {
  /** Username clients use to authenticate. */
  username: string;
  /** Credential clients use to authenticate. */
  credential: string;
  /** External IP coturn is advertising. */
  externalIp: string;
  /** Listening port. */
  port: number;
  /**
   * Whether the coturn process is still there to serve an allocation. False
   * once it has exited or failed to start, after which the credentials above
   * name a server that is gone.
   */
  running(): boolean;
  /** Stop the underlying coturn process. */
  stop(): Promise<void>;
}

const DEFAULT_PORT = 3478;

/** Lines of one kind forwarded per window before the rest are only counted. */
const LOG_LINES_PER_WINDOW = 20;
const LOG_WINDOW_MS = 10_000;
const DEFAULT_MIN_PORT = 49160;
const DEFAULT_MAX_PORT = 49199;

/**
 * Peer address ranges coturn refuses to relay to when `denyPrivatePeers` is
 * set: this host, RFC 1918, link-local (cloud metadata lives in 169.254/16),
 * the shared carrier range, and the IPv6 loopback, unique-local and link-local ranges.
 */
export const PRIVATE_PEER_RANGES: readonly string[] = [
  "0.0.0.0-0.255.255.255",
  "10.0.0.0-10.255.255.255",
  "100.64.0.0-100.127.255.255",
  "127.0.0.0-127.255.255.255",
  "169.254.0.0-169.254.255.255",
  "172.16.0.0-172.31.255.255",
  "192.168.0.0-192.168.255.255",
  "::1-::1",
  "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
];

/**
 * Spawn coturn with a fresh random secret. Resolves once the binary has
 * been spawned (not necessarily fully bound, that takes a few hundred
 * ms in practice; the readiness probe from the main screen is the
 * authoritative "is it actually serving" check).
 */
export function startCoturn(opts: CoturnOptions): CoturnHandle {
  const port = opts.port ?? DEFAULT_PORT;
  const minPort = opts.minPort ?? DEFAULT_MIN_PORT;
  const maxPort = opts.maxPort ?? DEFAULT_MAX_PORT;
  const username = opts.username ?? "gonogo";
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  const binary = opts.binaryPath ?? "turnserver";
  const realm = opts.realm ?? "gonogo";

  // coturn binds relay sockets on the `/private` address and only advertises
  // the public one. Without the private half it tries to bind the (non-local)
  // external IP and every allocation fails. See CoturnOptions.localIp.
  const externalIpArg = opts.localIp
    ? `${opts.externalIp}/${opts.localIp}`
    : opts.externalIp;

  const args = [
    "-n", // no config file: everything via CLI
    "--log-file=stdout",
    "--lt-cred-mech",
    `--realm=${realm}`,
    `--user=${username}:${secret}`,
    "--fingerprint",
    `--listening-port=${port}`,
    `--min-port=${minPort}`,
    `--max-port=${maxPort}`,
    // Hard cap on simultaneous allocations = the size of the relay pool. Once
    // every port is in use coturn returns a clean 486 "Allocation Quota
    // Reached" instead of silently spamming "create_relay_ioa_sockets: no
    // available ports" per retry: the latter buried the real signal in the
    // logs for ages. This is a diagnostic guardrail, not a connectivity fix:
    // the genuine relief for pool pressure is not handing TURN to LAN peers
    // in the first place (TURN-on-demand).
    `--total-quota=${maxPort - minPort + 1}`,
    `--external-ip=${externalIpArg}`,
    "--no-tls",
    "--no-dtls",
    // A reloaded page cannot release its allocations, so each one pins a
    // relay port until it expires. Coturn's default of 600s lets a few
    // reloads exhaust a small pool; healthy sessions refresh well inside
    // these windows.
    "--max-allocate-lifetime=120",
    "--channel-lifetime=60",
    ...(opts.denyPrivatePeers
      ? PRIVATE_PEER_RANGES.map((range) => `--denied-peer-ip=${range}`)
      : []),
  ];

  opts.logger.info(
    `[coturn] spawning ${binary} listening=${port} relay-range=${minPort}-${maxPort} external-ip=${externalIpArg}`,
  );

  const proc: ChildProcess = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  /*
   * The secret is on coturn's command line, so a startup banner or a debug
   * line that echoes its arguments would carry it into the relay's logs, which
   * reach Axiom.
   */
  const scrub = (line: string) => line.split(secret).join("[redacted]");

  const limiter = createLogRateLimiter(LOG_LINES_PER_WINDOW, LOG_WINDOW_MS);
  const flushTimer = setInterval(() => {
    for (const summary of limiter.flush()) {
      opts.logger.error(`[coturn] ${summary}`);
    }
  }, LOG_WINDOW_MS);
  flushTimer.unref();

  const forward = (write: (msg: string) => void) => (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length === 0) continue;
      const clean = scrub(line);
      if (limiter.allow(clean)) write(`[coturn] ${clean}`);
    }
  };
  proc.stdout?.on(
    "data",
    forward((m) => opts.logger.info(m)),
  );
  proc.stderr?.on(
    "data",
    forward((m) => opts.logger.error(m)),
  );

  let running = true;
  let stopping = false;
  const down = (reason: string) => {
    if (!running) return;
    running = false;
    clearInterval(flushTimer);
    for (const summary of limiter.flush()) {
      opts.logger.error(`[coturn] ${summary}`);
    }
    if (!stopping) opts.onExit?.(reason);
  };

  proc.on("error", (err) => {
    opts.logger.error("[coturn] spawn failed", err);
    down(`spawn failed: ${err.message}`);
  });

  proc.on("exit", (code, signal) => {
    opts.logger.error(`[coturn] exited code=${code} signal=${signal}`);
    down(`exited code=${code} signal=${signal}`);
  });

  return {
    username,
    credential: secret,
    externalIp: opts.externalIp,
    port,
    running: () => running,
    async stop(): Promise<void> {
      stopping = true;
      if (proc.exitCode !== null) return;
      proc.kill("SIGTERM");
      // Give coturn a beat to exit gracefully; force-kill if it doesn't.
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
    },
  };
}
