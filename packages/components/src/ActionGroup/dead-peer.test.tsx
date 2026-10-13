import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  TelemetryClient,
  TelemetryProvider,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDisabled } from "../test/isDisabled";
import { ActionGroupComponent } from "./index";

/**
 * A socket the peer has stopped answering on: it never fires `close` or
 * `error`, which is how a killed tunnel looks from the browser.
 */
class SilentPeerSocket {
  static readonly OPEN = 1;
  static current: SilentPeerSocket | undefined;
  readyState = 0;
  private readonly listeners = new Map<string, Array<(e: never) => void>>();
  constructor(_url: string) {
    SilentPeerSocket.current = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.fire("open", undefined as never);
    });
  }
  send(data: string) {
    const message = JSON.parse(data);
    if (message.type !== "subscribe" || message.topic !== "vessel.control") {
      return;
    }
    queueMicrotask(() =>
      this.fire("message", {
        data: JSON.stringify({
          type: "stream-data",
          topic: "vessel.control",
          payload: {
            sas: true,
            sasMode: 0,
            rcs: false,
            gear: false,
            brakes: false,
            lights: false,
            abort: false,
            precisionControl: false,
            throttle: 0,
            actionGroups: [],
          },
          meta: makeMeta(),
        }),
      } as never),
    );
  }
  close() {
    this.readyState = 3;
  }
  addEventListener(type: string, listener: (e: never) => void) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }
  private fire(type: string, event: never) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  clearActionHandlers();
  SilentPeerSocket.current = undefined;
  vi.useRealTimers();
});

describe("ActionGroup when the stream's peer goes silent without closing", () => {
  it("offers a press while the stream is live and a held, disabled control once the transport judges it dead", async () => {
    vi.useFakeTimers();
    const transport = new WebSocketTransport({
      url: "ws://localhost:8090",
      retryIntervalMs: 60_000,
      WebSocketImpl: SilentPeerSocket as never,
    });
    const client = new TelemetryClient(transport);
    render(
      <TelemetryProvider client={client}>
        <DashboardItemContext.Provider value={{ instanceId: "ag-dead" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "SAS" }}
            id="ag-dead"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </TelemetryProvider>,
    );
    const toggle = () =>
      screen.getByRole("button", { name: "Toggle SAS" }) as HTMLButtonElement;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(transport.status).toBe("connected");
    expect(isDisabled(toggle())).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(transport.status).toBe("reconnecting");
    expect(isDisabled(toggle())).toBe(true);
    expect(toggle().querySelector("[data-held-mark]")).not.toBeNull();

    transport.dispose();
    client.dispose();
  });
});
