import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CoturnHandle,
  PRIVATE_PEER_RANGES,
  startCoturn,
} from "../coturnManager.js";

const handles: CoturnHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.stop()));
});

/** A stand-in turnserver: a real child process that prints its own arguments, then runs for `lifetimeMs`. */
function fakeTurnserver(lifetimeMs: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "turn-")), "turnserver.sh");
  writeFileSync(
    path,
    `#!/bin/sh\nfor a in "$@"; do echo "arg $a"; done\nsleep ${lifetimeMs / 1000}\n`,
    { mode: 0o755 },
  );
  return path;
}

const quiet = { info: () => {}, error: () => {} };

function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("startCoturn", () => {
  it("passes no denied peer ranges by default so LAN peers can relay", async () => {
    const lines: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: fakeTurnserver(5000),
      logger: { info: (m) => lines.push(m), error: () => {} },
    });
    handles.push(h);
    await until(() => lines.some((l) => l.includes("--external-ip")));
    expect(lines.some((l) => l.includes("--denied-peer-ip"))).toBe(false);
  });

  it("denies private, loopback, link-local and CGNAT peers when the relay is public", async () => {
    const lines: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      denyPrivatePeers: true,
      binaryPath: fakeTurnserver(5000),
      logger: { info: (m) => lines.push(m), error: () => {} },
    });
    handles.push(h);
    await until(() => lines.some((l) => l.includes("--no-dtls")));
    await until(() =>
      PRIVATE_PEER_RANGES.every((r) =>
        lines.some((l) => l.endsWith(`--denied-peer-ip=${r}`)),
      ),
    );
    for (const range of [
      "10.0.0.0-10.255.255.255",
      "169.254.0.0-169.254.255.255",
      "100.64.0.0-100.127.255.255",
      "192.168.0.0-192.168.255.255",
    ]) {
      expect(PRIVATE_PEER_RANGES).toContain(range);
    }
  });

  it("never lets the shared secret reach the logger", async () => {
    const lines: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: fakeTurnserver(5000),
      logger: { info: (m) => lines.push(m), error: (m) => lines.push(m) },
    });
    handles.push(h);
    await until(() => lines.some((l) => l.includes("--user=gonogo:")));
    expect(lines.some((l) => l.includes(h.credential))).toBe(false);
    expect(lines.some((l) => l.includes("--user=gonogo:[redacted]"))).toBe(
      true,
    );
  });

  it("reports an unexpected exit through onExit and stops claiming to run", async () => {
    const reasons: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: fakeTurnserver(100),
      onExit: (r) => reasons.push(r),
      logger: quiet,
    });
    handles.push(h);
    expect(h.running()).toBe(true);
    await until(() => reasons.length > 0);
    expect(reasons[0]).toMatch(/exited/);
    expect(h.running()).toBe(false);
  });

  it("reports a missing binary through onExit", async () => {
    const reasons: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: "/nonexistent/turnserver",
      onExit: (r) => reasons.push(r),
      logger: quiet,
    });
    handles.push(h);
    await until(() => reasons.length > 0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/spawn failed/);
    expect(h.running()).toBe(false);
  });

  it("does not call onExit for a stop the caller asked for", async () => {
    const reasons: string[] = [];
    const h = startCoturn({
      externalIp: "203.0.113.1",
      binaryPath: fakeTurnserver(5000),
      onExit: (r) => reasons.push(r),
      logger: quiet,
    });
    await h.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(reasons).toEqual([]);
    expect(h.running()).toBe(false);
  });
});
