import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

const REPO = process.cwd();
const ENDPOINT_SRC = resolve(REPO, "packages/relay/endpoint");

export interface EndpointRelay {
  /** The relay's HTTP address. */
  readonly http: string;
  stop(): Promise<void>;
}

let built: string | null = null;

/** The endpoint binary, built once per run from the source under test. */
function endpointBinary(): string {
  if (built) return built;
  const dir = resolve(REPO, ".renders/endpoint-bin");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "gonogo-endpoint");
  execFileSync("go", ["build", "-o", out, "."], {
    cwd: ENDPOINT_SRC,
    stdio: "inherit",
  });
  built = out;
  return out;
}

/**
 * Boots the real relay with the real station endpoint, beside the suite's
 * own relay (which runs without one, so the direct path stays covered). The
 * endpoint runs on this machine, so its own interface addresses are the
 * ones a page here reaches it on; the public address is a documentation one
 * nothing answers on.
 */
export async function startEndpointRelay({
  port,
  endpointPort,
  env = {},
}: {
  port: number;
  endpointPort: number;
  env?: Record<string, string>;
}): Promise<EndpointRelay> {
  const binary = endpointBinary();
  const http = `http://localhost:${port}`;
  const proc: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@ksp-gonogo/relay", "exec", "tsx", "src/index.ts"],
    {
      cwd: REPO,
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        PORT: String(port),
        ENDPOINT_BIN: binary,
        ENDPOINT_PORT: String(endpointPort),
        ENDPOINT_CONTROL_PORT: String(port + 1),
        PUBLIC_IP: "192.0.2.1",
        ...env,
      },
    },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${http}/health`);
      const body = (await res.json()) as { endpoint?: unknown };
      if (res.ok && body.endpoint) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      stopGroup(proc);
      throw new Error("the relay's endpoint never came up");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    http,
    async stop() {
      stopGroup(proc);
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

/** pnpm, tsx, the relay and the endpoint are a chain of processes, so the group the relay was started in is signalled. */
function stopGroup(proc: ChildProcess): void {
  if (proc.pid === undefined) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

/** Point every main screen in `context` at `relay` instead of the suite's own relay. */
export async function pointAtRelay(
  context: BrowserContext,
  relay: EndpointRelay,
): Promise<void> {
  await context.addInitScript((url) => {
    (
      window as unknown as { __GONOGO_RELAY_URL__: string }
    ).__GONOGO_RELAY_URL__ = url;
  }, relay.http);
}

export type PcSpy = { __pcs: RTCPeerConnection[] };

/** Keep every RTCPeerConnection a page builds, so a test can ask one which pair it selected. */
export async function keepPeerConnections(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as PcSpy & {
      RTCPeerConnection: typeof RTCPeerConnection;
    };
    w.__pcs = [];
    const Original = w.RTCPeerConnection;
    w.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__pcs.push(this);
      }
    };
  });
}
