import { afterEach, describe, expect, it } from "vitest";
import { installTestHost, resetTestHost } from "../testing/install-test-host";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";

interface Line {
  level: string;
  message: string;
  context: unknown;
}

function captureLog(): Line[] {
  const lines: Line[] = [];
  const at = (level: string) => (message: string, context?: unknown) =>
    lines.push({ level, message, context });
  installTestHost({
    logger: {
      tag: () => ({
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
      }),
    },
  } as never);
  return lines;
}

describe("command outcome tracing", () => {
  afterEach(() => resetTestHost());

  it("logs a refusal with its code and the label the operator saw", async () => {
    const lines = captureLog();
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({
      success: false,
      errorCode: "ModeUnavailable",
      reason: "no active vessel",
    }));
    const client = new TelemetryClient(transport);

    const { result } = client.dispatch("vessel.stage", undefined, "Stage");
    await result.catch(() => {});

    expect(lines).toEqual([
      {
        level: "warn",
        message: "vessel.stage refused: ModeUnavailable",
        context: expect.objectContaining({
          command: "vessel.stage",
          label: "Stage",
          errorCode: "ModeUnavailable",
          reason: "no active vessel",
        }),
      },
    ]);
  });

  it("logs a confirmed command at debug, without its arguments", async () => {
    const lines = captureLog();
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({ success: true }));
    const client = new TelemetryClient(transport);

    await client.dispatch("vessel.rename", { name: "Kerbal X" }).result;

    expect(lines).toEqual([
      {
        level: "debug",
        message: "vessel.rename confirmed",
        context: { command: "vessel.rename" },
      },
    ]);
  });

  it("does not break the command when the host's logger is partial", async () => {
    installTestHost({ logger: {} } as never);
    const transport = new StubTransport();
    transport.setCommandHandler(() => ({ success: true }));
    const client = new TelemetryClient(transport);

    await expect(client.dispatch("x.y").result).resolves.toEqual({
      success: true,
    });
  });
});
