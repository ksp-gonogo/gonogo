import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const REPO = process.cwd();
const HERE = resolve(REPO, "tests/playwright");

export const RELAY_HTTP = "http://localhost:13003";
const TURN_PORT = 13478;

export interface TurnRelay {
  /** The relay's own `/ice-config`, which names the counting TURN server. */
  stop(): Promise<void>;
  /** Allocations the counting TURN server has made, freed or not. */
  allocations(): number;
  /** Allocations it holds right now. */
  live(): number;
  /** Permission or channel requests it refused toward a denied peer. */
  denied(): number;
}

/**
 * Boots the real relay against the counting TURN server in place of coturn:
 * the relay spawns `turnserver` from its search path, so a directory holding a
 * `turnserver` shim that runs the fake stands in for the binary the relay
 * image carries. Extra environment (RELAY_PUBLIC, for one) reaches the relay
 * unchanged.
 */
export async function startTurnRelay(
  relativeDir: string,
  env: Record<string, string> = {},
): Promise<TurnRelay> {
  const dir = resolve(REPO, relativeDir);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "turn.log");
  writeFileSync(log, "");
  const shim = join(dir, "turnserver");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec node ${join(HERE, "fake-turnserver.mjs")} "$@"\n`,
  );
  chmodSync(shim, 0o755);

  const proc: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@ksp-gonogo/relay", "exec", "tsx", "src/index.ts"],
    {
      cwd: REPO,
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        FAKE_TURN_LOG: log,
        PORT: "13003",
        TURN_EXTERNAL_IP: "127.0.0.1",
        TURN_PORT: String(TURN_PORT),
        RELAY_PUBLIC_URL: RELAY_HTTP,
        PEER_HOST: "localhost",
        PEER_PORT: String(PORTS.broker),
        PEER_PATH: "/myapp",
        PEER_SECURE: "0",
        ...env,
      },
    },
  );

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${RELAY_HTTP}/ice-config`);
      if (res.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      stopGroup(proc);
      throw new Error("the relay never served /ice-config");
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const lines = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
  return {
    allocations: () => lines().filter((l) => / ALLOC /.test(l)).length,
    live: () => {
      const all = lines().filter((l) => / (ALLOC|FREE) /.test(l));
      const last = all.at(-1)?.match(/live=(\d+)/);
      return last ? Number(last[1]) : 0;
    },
    denied: () => lines().filter((l) => / DENIED /.test(l)).length,
    async stop() {
      stopGroup(proc);
      await new Promise((r) => setTimeout(r, 500));
      rmSync(shim, { force: true });
    },
  };
}

/** pnpm, tsx, the relay and the TURN server are a chain of processes, so the group the relay was started in is signalled. */
function stopGroup(proc: ChildProcess): void {
  if (proc.pid === undefined) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

type PcRecord = {
  turn: boolean;
  relayOnly: boolean;
  candidates: string[];
};
export type PcSpy = { __pcs: PcRecord[] };

/**
 * Records, on every page of the context, each RTCPeerConnection built and
 * whether its ICE servers name a TURN server. With `relayOnly` the page can
 * only use a relay candidate (a connection handed TURN is built with
 * `iceTransportPolicy: "relay"`), which stands in for a network where no
 * direct path to the other screen exists.
 */
export async function spyOnPeerConnections(
  context: BrowserContext,
  relayOnly: boolean,
): Promise<void> {
  await context.addInitScript((forceRelay) => {
    const w = window as unknown as PcSpy & {
      RTCPeerConnection: typeof RTCPeerConnection;
    };
    w.__pcs = [];
    const Original = w.RTCPeerConnection;
    w.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        const turn = JSON.stringify(config?.iceServers ?? []).includes("turn:");
        const relayOnly = forceRelay && turn;
        super(relayOnly ? { ...config, iceTransportPolicy: "relay" } : config);
        const record: PcRecord = { turn, relayOnly, candidates: [] };
        w.__pcs.push(record);
        this.addEventListener("icecandidate", (e) => {
          if (e.candidate) {
            const f = e.candidate.candidate.split(" ");
            record.candidates.push(`${f[7]} ${f[4]}`);
          }
        });
      }
    };
  }, relayOnly);
}
