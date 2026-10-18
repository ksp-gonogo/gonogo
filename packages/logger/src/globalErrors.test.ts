import { describe, expect, it } from "vitest";
import { installGlobalErrorHooks } from "./globalErrors.js";
import { ConsoleLogger } from "./index.js";

function setup() {
  const target = new EventTarget();
  const logger = new ConsoleLogger({ enabled: true, persist: null });
  let clock = 0;
  const remove = installGlobalErrorHooks(target, logger, () => clock);
  const fire = (type: string, fields: Record<string, unknown>) => {
    const event = new Event(type);
    Object.assign(event, fields);
    target.dispatchEvent(event);
  };
  return {
    logger,
    fire,
    remove,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("installGlobalErrorHooks", () => {
  it("logs an uncaught throw with its stack", () => {
    const { logger, fire } = setup();
    const thrown = new TypeError("x is undefined");
    fire("error", { message: thrown.message, error: thrown, lineno: 3 });

    const [entry] = logger.getBuffer();
    expect(entry).toMatchObject({
      level: "error",
      tag: "uncaught",
      message: "[uncaught] error: x is undefined",
      error: { name: "TypeError", message: "x is undefined" },
      context: { kind: "error", line: 3 },
    });
    expect(entry?.error?.stack).toContain("x is undefined");
  });

  it("logs a rejection whose reason is not an Error", () => {
    const { logger, fire } = setup();
    fire("unhandledrejection", { reason: { code: "E_LOST" } });

    expect(logger.getBuffer()[0]).toMatchObject({
      message: '[uncaught] unhandled rejection: {"code":"E_LOST"}',
      context: { kind: "unhandled rejection" },
    });
  });

  it("holds back a repeating error and counts it on the next entry", () => {
    const { logger, fire, advance } = setup();
    const thrown = new Error("frame failed");
    for (let i = 0; i < 5; i++) fire("error", { error: thrown });
    advance(10_000);
    fire("error", { error: thrown });

    const entries = logger.getBuffer();
    expect(entries).toHaveLength(2);
    expect(entries[1]?.context).toMatchObject({ repeats: 4 });
  });

  it("ignores the browser's benign ResizeObserver loop error", () => {
    const { logger, fire } = setup();
    fire("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
    });
    expect(logger.getBuffer()).toHaveLength(0);
  });

  it("keeps an interrupted media play() silent and warns once on any other refusal", () => {
    const { logger, fire } = setup();
    const interrupted = new DOMException(
      "The play() request was interrupted by a new load request.",
      "AbortError",
    );
    fire("unhandledrejection", { reason: interrupted });
    expect(logger.getBuffer()).toHaveLength(0);

    const refused = new DOMException(
      "play() failed because the user didn't interact with the document first.",
      "NotAllowedError",
    );
    fire("unhandledrejection", { reason: refused });
    fire("unhandledrejection", { reason: refused });
    expect(logger.getBuffer()).toHaveLength(1);
    expect(logger.getBuffer()[0]).toMatchObject({
      level: "warn",
      context: { reason: "NotAllowedError" },
    });
  });

  it("stops listening once removed", () => {
    const { logger, fire, remove } = setup();
    remove();
    fire("error", { error: new Error("late") });
    expect(logger.getBuffer()).toHaveLength(0);
  });
});
