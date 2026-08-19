import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActionHandlers,
  dispatchAction,
  registerActionHandler,
  unregisterActionHandler,
} from "./action-dispatch";

beforeEach(() => clearActionHandlers());

describe("action dispatcher", () => {
  it("invokes the registered handler and returns its value", () => {
    const handler = vi.fn().mockReturnValue({ ok: true });
    registerActionHandler("widget-1", "toggle", handler);

    const result = dispatchAction("widget-1", "toggle", {
      kind: "button",
      value: true,
    });

    expect(handler).toHaveBeenCalledWith({ kind: "button", value: true });
    expect(result).toEqual({ ok: true });
  });

  it("returns undefined and does nothing for unknown instances", () => {
    const result = dispatchAction("no-such-widget", "toggle", {
      kind: "button",
      value: true,
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined and does nothing for unknown actions on a known instance", () => {
    const handler = vi.fn();
    registerActionHandler("widget-1", "toggle", handler);

    const result = dispatchAction("widget-1", "nope", {
      kind: "button",
      value: true,
    });

    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates handlers by instance ID", () => {
    const a = vi.fn().mockReturnValue("a");
    const b = vi.fn().mockReturnValue("b");
    registerActionHandler("widget-a", "toggle", a);
    registerActionHandler("widget-b", "toggle", b);

    expect(
      dispatchAction("widget-a", "toggle", { kind: "button", value: true }),
    ).toBe("a");
    expect(
      dispatchAction("widget-b", "toggle", { kind: "button", value: true }),
    ).toBe("b");
  });

  it("unregisters a single action without affecting siblings", () => {
    const toggle = vi.fn().mockReturnValue(1);
    const reset = vi.fn().mockReturnValue(2);
    registerActionHandler("widget-1", "toggle", toggle);
    registerActionHandler("widget-1", "reset", reset);

    unregisterActionHandler("widget-1", "toggle");

    expect(
      dispatchAction("widget-1", "toggle", { kind: "button", value: true }),
    ).toBeUndefined();
    expect(
      dispatchAction("widget-1", "reset", { kind: "button", value: true }),
    ).toBe(2);
  });

  it("replaces the handler when registered twice under the same key", () => {
    const first = vi.fn().mockReturnValue("first");
    const second = vi.fn().mockReturnValue("second");
    registerActionHandler("widget-1", "toggle", first);
    registerActionHandler("widget-1", "toggle", second);

    const result = dispatchAction("widget-1", "toggle", {
      kind: "button",
      value: true,
    });

    expect(result).toBe("second");
    expect(first).not.toHaveBeenCalled();
  });
});
