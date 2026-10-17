import { ConsoleLogger } from "@ksp-gonogo/logger";
import { describe, expect, it } from "vitest";
import { streamStatusTracer, traceHello } from "./streamTrace";

function setup() {
  const logger = new ConsoleLogger({ enabled: true, persist: null });
  let clock = 0;
  const trace = streamStatusTracer(logger.tag("sitrep"), () => clock);
  const lines = () =>
    logger.getBuffer().map((e) => [e.level, e.message, e.context]);
  return {
    trace,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("streamStatusTracer", () => {
  it("says once that it is waiting, however many attempts fail", () => {
    const { trace, lines } = setup();
    trace("disconnected");
    trace("reconnecting");
    trace("reconnecting");
    trace("connected");
    expect(lines()).toEqual([
      ["info", "[sitrep] waiting for the game to accept the stream", undefined],
      ["info", "[sitrep] stream connected", undefined],
    ]);
  });

  it("logs a drop and the reconnection with how long the stream was down", () => {
    const { trace, lines, advance } = setup();
    trace("connected");
    trace("reconnecting");
    advance(61_400);
    trace("connected");
    expect(lines().slice(1)).toEqual([
      [
        "warn",
        "[sitrep] stream lost, reconnecting",
        { status: "reconnecting" },
      ],
      ["info", "[sitrep] stream reconnected", { outageSeconds: 61 }],
    ]);
  });

  it("logs a closed stream at info, since closing is deliberate", () => {
    const { trace, lines } = setup();
    trace("connected");
    trace("disconnected");
    expect(lines()[1]).toEqual(["info", "[sitrep] stream closed", undefined]);
  });
});

describe("traceHello", () => {
  it("names the mod build and says when the game restarted", () => {
    const logger = new ConsoleLogger({ enabled: true, persist: null });
    traceHello(logger.tag("sitrep"), {
      modVersion: "1.0.0-rc.39",
      contractMajor: 4,
      contractMinor: 2,
      rebooted: true,
    });
    expect(logger.getBuffer()[0]).toMatchObject({
      message: "[sitrep] mod hello, the game has restarted",
      context: { modVersion: "1.0.0-rc.39", contract: "4.2" },
    });
  });
});
