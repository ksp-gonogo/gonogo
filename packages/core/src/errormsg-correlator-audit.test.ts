import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every `ErrorMsg` the mod mints can be reached by the client that receives it.
 *
 * The SDK routes an `error` frame three ways and each way needs a field: a
 * `requestId` reaches the command correlator, a `topic` reaches the channel
 * warning, and everything else reaches `warnConnectionError`. That third route
 * exists since 2026-09-16; before it, a frame carrying neither field arrived,
 * matched no branch, and was dropped on `handleCommandError`'s
 * `if (!requestId) return`. `binary-frame-not-accepted` spent its whole life
 * there: the mod wrote a genuinely useful sentence about the binary lane and
 * nothing ever printed it.
 *
 * So the client half is fixed and cannot regress (`connection-error-warning.test.ts`
 * covers it). What a type cannot hold is the MOD half: a refusal that answers a
 * REQUEST must carry that request's id, or the author's dispatch hangs to its
 * loss timer having been answered in full. The connection-level route is a real
 * destination, not a catch-all to drop a correlator into.
 *
 * Hence the allowlist below, keyed by method and code rather than by code
 * alone: `unknown-vantage` is minted twice, once for a `set-vantage` (whose
 * envelope carries no request id to correlate by) and once for a command
 * request (which does). Keyed by code they would be indistinguishable, and the
 * one that must carry a correlator could quietly stop.
 */

const SCAN_ROOTS = ["mod"];

/** Uncorrelated mints that are connection-level by construction, with the reason. */
const CONNECTION_LEVEL: Record<string, string> = {
  "RefuseInboundBinaryFrame/binary-frame-not-accepted":
    "A binary frame sent UP the socket is refused before anything reads a request id out of it: there is none, the lane byte is the whole frame header. The fault is about the connection, not about any one command.",
  "HandleSetVantage/unknown-vantage":
    "`SetVantage` carries no RequestId (Sitrep.Contract/Envelope.cs): it is a connection-wide directive, not a request. Its refusal is correspondingly connection-wide.",
};

/**
 * A mint whose correlator is best-effort, so it can legitimately come out null.
 *
 * `RefuseInvalidEnvelope` salvages the requestId off the raw frame where the
 * frame carried a readable one, which is the most any code reading an envelope
 * it could not parse can do. It WRITES `RequestId`, so it passes the check
 * below on its own; it is named here only so the next reader knows the field
 * being present is not the same as the value being non-null.
 */
const BEST_EFFORT = ["RefuseInvalidEnvelope/invalid-envelope"];

/**
 * A `new ErrorMsg` and the object initializer that follows it.
 *
 * Non-greedy to the first `}`, which is enough: every mint in the tree is a
 * flat initializer of scalar fields, and the FLOOR below fails if a nesting
 * that broke this ever appeared and cost the scan its subjects.
 */
const MINT_RE = /new\s+ErrorMsg\s*\{([^}]*)\}/g;

/** The nearest enclosing method declaration, read backwards from a mint. */
const METHOD_RE =
  /(?:private|public|internal|protected)[\w\s<>,[\]]*?\s(\w+)\s*\([^)]*\)\s*(?:where[^{]*)?\{/g;

/**
 * How many mint sites the scan must find before it is entitled to pass.
 *
 * Eight as of 2026-09-16 (all in `Sitrep.Host/ChannelEngine.cs`). A regex that
 * stopped matching would otherwise report a clean tree, which is the failure
 * mode this whole family of gates exists to avoid: a counter that cannot see a
 * violation reports zero, and zero reads as success.
 */
const MINT_FLOOR = 8;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function trackedCsharp(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => rel.endsWith(".cs") && !/\bTests?\//.test(rel));
}

interface Mint {
  readonly file: string;
  readonly method: string;
  readonly code: string;
  readonly correlated: boolean;
  readonly topical: boolean;
}

function enclosingMethod(source: string, upTo: number): string {
  const head = source.slice(0, upTo);
  let name = "<file scope>";
  METHOD_RE.lastIndex = 0;
  for (const match of head.matchAll(METHOD_RE)) name = match[1];
  return name;
}

function mintsIn(rel: string, source: string): Mint[] {
  const mints: Mint[] = [];
  for (const match of source.matchAll(MINT_RE)) {
    const body = match[1];
    const code = /\bCode\s*=\s*"([^"]+)"/.exec(body);
    mints.push({
      file: rel,
      method: enclosingMethod(source, match.index ?? 0),
      code: code ? code[1] : "<computed>",
      correlated: /\bRequestId\s*=/.test(body),
      topical: /\bTopic\s*=/.test(body),
    });
  }
  return mints;
}

function allMints(): Mint[] {
  const mints: Mint[] = [];
  for (const rel of trackedCsharp()) {
    mints.push(...mintsIn(rel, readFileSync(join(ROOT, rel), "utf8")));
  }
  return mints;
}

describe("every ErrorMsg the mod mints can be routed by the client", () => {
  it("finds the mint sites at all", () => {
    expect(allMints().length).toBeGreaterThanOrEqual(MINT_FLOOR);
  });

  it("gives each one a requestId, a topic, or a named reason for neither", () => {
    const unroutable = allMints()
      .filter((m) => !m.correlated && !m.topical)
      .filter((m) => !(`${m.method}/${m.code}` in CONNECTION_LEVEL));
    expect(
      unroutable.map((m) => `${m.file} ${m.method} ${m.code}`),
      "An ErrorMsg with neither a RequestId nor a Topic is a CONNECTION-level " +
        "diagnostic: the client logs it through warnConnectionError and no " +
        "dispatch or channel ever hears about it. If this one answers a " +
        "request, carry that request's id, or the caller waits out its loss " +
        "timer having been answered in full. If it really is connection-level, " +
        "add it to CONNECTION_LEVEL with the reason.",
    ).toEqual([]);
  });

  /**
   * The gate can SEE the thing it is looking for. A planted request-scoped
   * refusal with no correlator must be reported, and the same text with a
   * `RequestId` must not, or the clean result above means nothing.
   */
  it("reports a planted request-scoped mint that drops its correlator", () => {
    const planted = `
      private void RefuseSomething(ClientSession session, CommandRequest req)
      {
          var error = new ErrorMsg
          {
              Code = "planted-refusal",
              Message = "no correlator on this one",
          };
      }`;
    const [bad] = mintsIn("planted.cs", planted);
    expect(bad.method).toBe("RefuseSomething");
    expect(bad.code).toBe("planted-refusal");
    expect(bad.correlated).toBe(false);
    expect(bad.topical).toBe(false);
    expect(`${bad.method}/${bad.code}` in CONNECTION_LEVEL).toBe(false);

    const [good] = mintsIn(
      "planted.cs",
      planted.replace(
        "Code =",
        "RequestId = req.RequestId,\n              Code =",
      ),
    );
    expect(good.correlated).toBe(true);
  });

  /** The allowlist names live sites, not sites that have since moved or gone. */
  it("keeps no allowlist entry that has no subject", () => {
    const live = new Set(allMints().map((m) => `${m.method}/${m.code}`));
    const orphans = [...Object.keys(CONNECTION_LEVEL), ...BEST_EFFORT].filter(
      (key) => !live.has(key),
    );
    expect(orphans).toEqual([]);
  });
});
