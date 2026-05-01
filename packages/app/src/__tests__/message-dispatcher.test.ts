import { describe, expect, it, vi } from "vitest";
import { MessageDispatcher } from "../peer/MessageDispatcher";
import type { PeerMessage } from "../peer/protocol";

describe("MessageDispatcher", () => {
  it("looks up the handler by msg.type and calls it with (msg, ctx)", () => {
    const handler = vi.fn();
    const dispatcher = new MessageDispatcher<{ tag: string }>({
      data: handler,
    });
    const ctx = { tag: "X" };
    const msg: PeerMessage = {
      type: "data",
      sourceId: "s",
      key: "k",
      value: 1,
    };

    dispatcher.dispatch(msg, ctx);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(msg, ctx);
  });

  it("is a no-op for message types with no registered handler", () => {
    const dispatcher = new MessageDispatcher<void>({});
    expect(() => {
      dispatcher.dispatch(
        { type: "data", sourceId: "s", key: "k", value: 1 },
        undefined,
      );
    }).not.toThrow();
  });

  it("dispatches synchronously — call order is preserved across consecutive dispatches", () => {
    const calls: string[] = [];
    const dispatcher = new MessageDispatcher<void>({
      data: () => calls.push("data"),
      status: () => calls.push("status"),
      schema: () => calls.push("schema"),
    });

    dispatcher.dispatch(
      { type: "data", sourceId: "s", key: "k", value: 1 },
      undefined,
    );
    dispatcher.dispatch(
      { type: "status", sourceId: "s", status: "connected" },
      undefined,
    );
    dispatcher.dispatch({ type: "schema", sources: [] }, undefined);

    expect(calls).toEqual(["data", "status", "schema"]);
  });

  it("only the matching handler fires — sibling handlers are not consulted", () => {
    const dataH = vi.fn();
    const statusH = vi.fn();
    const dispatcher = new MessageDispatcher<void>({
      data: dataH,
      status: statusH,
    });

    dispatcher.dispatch(
      { type: "data", sourceId: "s", key: "k", value: 1 },
      undefined,
    );
    expect(dataH).toHaveBeenCalledTimes(1);
    expect(statusH).not.toHaveBeenCalled();
  });

  it("re-dispatching the same type calls the handler again with the new payload", () => {
    const handler = vi.fn();
    const dispatcher = new MessageDispatcher<void>({ data: handler });

    dispatcher.dispatch(
      { type: "data", sourceId: "s", key: "k", value: 1 },
      undefined,
    );
    dispatcher.dispatch(
      { type: "data", sourceId: "s", key: "k", value: 2 },
      undefined,
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(
      (handler.mock.calls[1][0] as Extract<PeerMessage, { type: "data" }>)
        .value,
    ).toBe(2);
  });
});
