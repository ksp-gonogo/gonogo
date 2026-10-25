import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startEndpoint } from "../endpointManager.js";

/** A stand-in endpoint binary: prints its arguments, then runs until signalled, or exits at once with `exitCode`. */
function fakeBinary(exitCode?: number): string {
  const dir = mkdtempSync(join(tmpdir(), "endpoint-"));
  const path = join(dir, "gonogo-endpoint");
  const body =
    exitCode === undefined
      ? "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"
      : `process.exit(${exitCode});`;
  writeFileSync(
    path,
    `#!${process.execPath}\nconsole.log("args " + JSON.stringify(process.argv.slice(2)));\n${body}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function recorder() {
  const info: string[] = [];
  const error: string[] = [];
  return {
    info,
    error,
    logger: {
      info: (m: string) => info.push(m),
      error: (m: string) => error.push(m),
    },
  };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(cond()).toBe(true);
};

describe("startEndpoint", () => {
  it("passes the port, the control address and both advertised addresses to the binary", async () => {
    const log = recorder();
    const handle = startEndpoint({
      binaryPath: fakeBinary(),
      port: 47100,
      control: "127.0.0.1:3003",
      publicIp: "203.0.113.7",
      lanIp: "198.51.100.20",
      logger: log.logger,
    });
    await until(() => log.info.some((l) => l.includes("args")));
    const line = log.info.find((l) => l.includes("args")) ?? "";
    expect(JSON.parse(line.slice(line.indexOf("args ") + 5))).toEqual([
      "-port",
      "47100",
      "-control",
      "127.0.0.1:3003",
      "-public-ip",
      "203.0.113.7",
      "-lan-ip",
      "198.51.100.20",
    ]);
    expect(handle.running()).toBe(true);
    await handle.stop();
    expect(handle.running()).toBe(false);
  });

  it("leaves out a LAN address it was not given", async () => {
    const log = recorder();
    const handle = startEndpoint({
      binaryPath: fakeBinary(),
      port: 47100,
      control: "127.0.0.1:3003",
      publicIp: "203.0.113.7",
      lanIp: null,
      logger: log.logger,
    });
    await until(() => log.info.some((l) => l.includes("args")));
    expect(log.info.join("\n")).not.toContain("-lan-ip");
    await handle.stop();
  });

  it("reports an exit it did not ask for, and not one it did", async () => {
    const exits: string[] = [];
    const crashed = startEndpoint({
      binaryPath: fakeBinary(1),
      port: 47100,
      control: "127.0.0.1:3003",
      publicIp: "203.0.113.7",
      lanIp: null,
      onExit: (r) => exits.push(r),
      logger: recorder().logger,
    });
    await until(() => !crashed.running());
    expect(exits).toEqual(["exited code=1 signal=null"]);

    const stopped = startEndpoint({
      binaryPath: fakeBinary(),
      port: 47100,
      control: "127.0.0.1:3003",
      publicIp: "203.0.113.7",
      lanIp: null,
      onExit: (r) => exits.push(r),
      logger: recorder().logger,
    });
    await stopped.stop();
    expect(exits).toHaveLength(1);
  });

  it("reports a binary that is not there", async () => {
    const exits: string[] = [];
    const handle = startEndpoint({
      binaryPath: "/nonexistent/gonogo-endpoint",
      port: 47100,
      control: "127.0.0.1:3003",
      publicIp: "203.0.113.7",
      lanIp: null,
      onExit: (r) => exits.push(r),
      logger: recorder().logger,
    });
    await until(() => exits.length > 0);
    expect(exits[0]).toMatch(/spawn failed/);
    expect(handle.running()).toBe(false);
  });
});
