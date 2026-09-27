import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A scratch directory made by a repo script is removed however the script
 * ends. The NuGet extraction probe alone leaves several hundred megabytes per
 * run, and the gates run it on every push, so a leak on any exit path fills
 * the shared disk and turns every gate red with ENOSPC.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPER = pathToFileURL(join(ROOT, "scripts", "temp-dir.mjs")).href;

function script(body: string): string {
  return `import { makeTempDir } from ${JSON.stringify(HELPER)};
const dir = makeTempDir("gonogo-temp-dir-test-");
console.log(dir);
${body}`;
}

function runToEnd(body: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script(body)],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return { dir: r.stdout.split("\n")[0], status: r.status, stderr: r.stderr };
}

/** Polls rather than asserting at once: the signal paths remove asynchronously. */
async function goneWithin(dir: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!existsSync(dir)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !existsSync(dir);
}

/** Starts a script blocked in spawnSync, where no JS signal handler can run, and signals it once its directory exists. */
async function killMidway(signal: NodeJS.Signals): Promise<string> {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script(`
import { spawnSync } from "node:child_process";
spawnSync("sleep", ["30"]);`),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const dir = await new Promise<string>((resolve) =>
    child.stdout.once("data", (d: Buffer) =>
      resolve(d.toString().split("\n")[0]),
    ),
  );
  expect(existsSync(dir)).toBe(true);
  const exited = new Promise((r) => child.once("exit", r));
  child.kill(signal);
  await exited;
  return dir;
}

describe("scripts/temp-dir.mjs removes its directory on every exit path", () => {
  it("on a normal finish", () => {
    const { dir, status } = runToEnd("");
    expect(status).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it("on a thrown error", () => {
    const { dir, status } = runToEnd(`throw new Error("midway");`);
    expect(status).not.toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it("on process.exit inside a try, which skips finally", () => {
    const { dir, status } = runToEnd(
      `try { process.exit(1); } finally { console.log("unreached"); }`,
    );
    expect(status).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("on SIGTERM while blocked in spawnSync", async () => {
    const dir = await killMidway("SIGTERM");
    expect(await goneWithin(dir, 5000)).toBe(true);
  }, 15000);

  it("on SIGKILL", async () => {
    const dir = await killMidway("SIGKILL");
    expect(await goneWithin(dir, 5000)).toBe(true);
  }, 15000);

  it("keeps it under GONOGO_KEEP_TMP=1 and says where", async () => {
    const { dir, stderr } = runToEnd("", { GONOGO_KEEP_TMP: "1" });
    try {
      expect(existsSync(dir)).toBe(true);
      expect(stderr).toContain(dir);
      await new Promise((r) => setTimeout(r, 600));
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("no repo script makes a temp dir behind the helper's back", () => {
  it("every scripts/ node module reaches the temp root through makeTempDir", () => {
    const offenders = readdirSync(join(ROOT, "scripts"))
      .filter((f) => /\.m?[jt]s$/.test(f) && f !== "temp-dir.mjs")
      .filter((f) =>
        /\bmkdtemp(Sync)?\s*\(/.test(
          readFileSync(join(ROOT, "scripts", f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("every shell mktemp in scripts/ has an EXIT trap removing it", () => {
    const files = execFileSync("git", ["ls-files", "scripts/*.sh"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const untrapped = files.filter((f) => {
      const text = readFileSync(join(ROOT, f), "utf8");
      return /\$\(mktemp\b/.test(text) && !/\btrap\s+\S.*\bEXIT\b/.test(text);
    });
    expect(untrapped).toEqual([]);
  });
});
