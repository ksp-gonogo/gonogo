import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Manages a coturn child process, generating a fresh shared-secret on
 * every startup and feeding coturn its discovered public IP. Bundling
 * coturn into the proxy container means:
 *
 *   - One container to run; users get TURN out of the box without
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
   * Needed whenever `externalIp` is a NAT / published address that isn't a
   * local interface — the usual container case: without it coturn tries to
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
   * Max relay port. Defaults to 49170 — coturn allocates one relay port
   * per active TURN session, so 11 ports comfortably covers ≤10
   * simultaneous TURN-using clients. Bumped down from the original
   * 49200 because Google Wi-Fi (and most consumer routers) require
   * one port-forward entry per port; the old range demanded 41
   * clicks. If your sessions routinely exceed ~10 concurrent
   * TURN-relayed clients, widen this and the matching docker-compose
   * mapping + Dockerfile EXPOSE.
   */
  maxPort?: number;
  /** Username for static credentials. Defaults to `gonogo`. */
  username?: string;
  /** Existing secret to reuse. Generated if omitted. */
  secret?: string;
  /** Path to the turnserver binary. Defaults to `turnserver`. */
  binaryPath?: string;
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
  /** Stop the underlying coturn process. */
  stop(): Promise<void>;
}

const DEFAULT_PORT = 3478;
const DEFAULT_MIN_PORT = 49160;
const DEFAULT_MAX_PORT = 49170;

/**
 * Spawn coturn with a fresh random secret. Resolves once the binary has
 * been spawned (not necessarily fully bound — that takes a few hundred
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
    "-n", // no config file — everything via CLI
    "--log-file=stdout",
    "--lt-cred-mech",
    `--realm=${realm}`,
    `--user=${username}:${secret}`,
    "--fingerprint",
    `--listening-port=${port}`,
    `--min-port=${minPort}`,
    `--max-port=${maxPort}`,
    `--external-ip=${externalIpArg}`,
    "--no-tls",
    "--no-dtls",
    // Aggressive idle cleanup — coturn's defaults give an unused
    // allocation up to 600s (10min) before reclaim. With our small
    // 11-port relay range, a station retry storm or a few quick
    // host reconnects exhaust the pool faster than the default
    // sweeper can recover, and `create_relay_ioa_sockets: no
    // available ports` starts firing — at which point new TURN
    // allocations (including the host's own) fail and peers on
    // restrictive networks silently lose connectivity. 5 min max +
    // 1 min channel timeout halves the worst-case pin time without
    // affecting healthy sessions, which actively refresh well within
    // these windows.
    "--max-allocate-lifetime=300",
    "--channel-lifetime=60",
  ];

  opts.logger.info(
    `[coturn] spawning ${binary} listening=${port} relay-range=${minPort}-${maxPort} external-ip=${externalIpArg}`,
  );

  const proc: ChildProcess = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    // coturn is chatty at default verbosity; surface line-by-line so the
    // proxy's log timestamps interleave correctly.
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) opts.logger.info(`[coturn] ${line}`);
    }
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) opts.logger.error(`[coturn] ${line}`);
    }
  });

  proc.on("error", (err) => {
    opts.logger.error("[coturn] spawn failed", err);
  });

  proc.on("exit", (code, signal) => {
    opts.logger.error(`[coturn] exited code=${code} signal=${signal}`);
  });

  return {
    username,
    credential: secret,
    externalIp: opts.externalIp,
    port,
    async stop(): Promise<void> {
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
