import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dotnet, explainSilentFailure } from "./codegen";

const originalPath = process.env.PATH;

/** A `dotnet` on PATH that records its arguments and answers by whether the run is verbose. */
function fakeDotnet(quiet: string, verbose: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-dotnet-"));
  const log = join(dir, "args.log");
  const script = join(dir, "dotnet");
  writeFileSync(
    script,
    `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *-v:n*) printf '%s\\n' ${JSON.stringify(verbose)} ;;
  *) printf '%s\\n' ${JSON.stringify(quiet)} ;;
esac
exit 1
`,
  );
  chmodSync(script, 0o755);
  process.env.PATH = `${dir}${delimiter}${originalPath}`;
  return log;
}

afterEach(() => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
});

describe("dotnet", () => {
  it("passes -nodeReuse:false to a build", () => {
    const log = fakeDotnet("Build FAILED. 0 Error(s)", "no detail");
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(() => dotnet("compile", ["build", "p.csproj"])).toThrow();
    expect(readFileSync(log, "utf8").split("\n")[0]).toContain(
      "-nodeReuse:false",
    );
  });

  it("explains a failure that reported no error from a more verbose run", () => {
    const log = fakeDotnet(
      "Build FAILED.\n    0 Warning(s)\n    0 Error(s)",
      "MSBuild: SocketException: permission denied creating the node pipe",
    );
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(() =>
      dotnet("compile the plugin", [
        "build",
        "p.csproj",
        "-v",
        "quiet",
        "-clp:ErrorsOnly",
      ]),
    ).toThrow(
      /reported no error[\s\S]*permission denied[\s\S]*-nodeReuse:false/,
    );
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("-v:n");
    expect(calls[1]).not.toContain("ErrorsOnly");
  });

  it("leaves a failure that names an error as it was", () => {
    const log = fakeDotnet("A.cs(1,1): error CS1002: ; expected", "unused");
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(() => dotnet("compile", ["build", "p.csproj"])).toThrow(
      /compile failed, so nothing after it ran/,
    );
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("explainSilentFailure", () => {
  it("says so when a verbose run names nothing", () => {
    expect(explainSilentFailure("compile", "Build started\n")).toContain(
      "printed nothing that names a cause",
    );
  });
});
