import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_USAGE, parseDevArgs } from "../../../scripts/dev-args.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../scripts/dev-args.mjs");

/**
 * `pnpm dev --uplink <path>` is how an Uplink author puts a client they are
 * building into the running app. The shell script that starts the stack calls
 * this first, so a bad flag has to stop it before podman starts.
 */
describe("pnpm dev flags", () => {
  it("resolves a relative path against where the command was typed", () => {
    const parsed = parseDevArgs(["--uplink", "../alpha"], "/work/gonogo");
    expect(parsed).toEqual({ uplinks: ["/work/alpha"] });
  });

  it("joins repeated flags in order and leaves absolute paths alone", () => {
    const parsed = parseDevArgs(
      ["--uplink", "/a/one", "--uplink", "two"],
      "/work",
    );
    expect(parsed).toEqual({ uplinks: ["/a/one", "/work/two"] });
  });

  it("takes no Uplinks when none are named", () => {
    expect(parseDevArgs([], "/work")).toEqual({ uplinks: [] });
  });

  it("refuses an unknown flag, with the usage", () => {
    const parsed = parseDevArgs(["--uplinks", "x"], "/work");
    expect(parsed).toMatchObject({
      error: expect.stringContaining("--uplinks"),
    });
    expect(parsed).toMatchObject({ error: expect.stringContaining(DEV_USAGE) });
  });

  it("refuses --uplink with no path after it", () => {
    expect(parseDevArgs(["--uplink"], "/work")).toMatchObject({
      error: expect.stringContaining("--uplink needs a path"),
    });
    expect(parseDevArgs(["--uplink", "--help"], "/work")).toMatchObject({
      error: expect.stringContaining("--uplink needs a path"),
    });
  });

  it("answers --help with the usage", () => {
    expect(parseDevArgs(["--help"], "/work")).toEqual({ help: DEV_USAGE });
  });
});

describe("scripts/dev-args.mjs as the shell script runs it", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, INIT_CWD: "/work", ...env },
    });

  it("prints a shell statement that exports the paths, newline separated", () => {
    const out = run(["--uplink", "/a b/one", "--uplink", "two"]);
    expect(out.status).toBe(0);
    const probe = spawnSync(
      "sh",
      ["-c", `${out.stdout}\nprintf '%s' "$GONOGO_LOCAL_UPLINKS"`],
      { encoding: "utf8" },
    );
    expect(probe.stdout).toBe(`/a b/one\n${join("/work", "two")}`);
  });

  it("survives a quote in a path", () => {
    const out = run(["--uplink", "/it's/here"]);
    const probe = spawnSync(
      "sh",
      ["-c", `${out.stdout}\nprintf '%s' "$GONOGO_LOCAL_UPLINKS"`],
      { encoding: "utf8" },
    );
    expect(probe.stdout).toBe("/it's/here");
  });

  it("exits 10 with the usage on stdout for --help, so nothing starts", () => {
    const out = run(["--help"]);
    expect(out.status).toBe(10);
    expect(out.stdout).toContain(DEV_USAGE);
  });

  it("exits 2 with the usage on stderr for an unknown flag", () => {
    const out = run(["--nope"]);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("--nope");
    expect(out.stdout).toBe("");
  });
});
