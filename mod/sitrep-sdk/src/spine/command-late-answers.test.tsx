// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Transport, TransportStatus } from "../api/transport";
import type { ClientMessage, ServerMessage } from "../envelope";
import { act, render, screen } from "../testing";
import { makeMeta } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { TelemetryProvider } from "./context";
import { useCommand } from "./use-command";

class ManualClock implements Clock {
  private time = 0;
  private readonly timers = new Set<{ at: number; fn: () => void }>();
  now() {
    return this.time;
  }
  schedule(at: number, fn: () => void) {
    const timer = { at, fn };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }
  advance(seconds: number) {
    const end = this.time + seconds;
    for (;;) {
      const next = [...this.timers]
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers.delete(next);
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    this.time = end;
  }
}

class ModTransport implements Transport {
  status: TransportStatus = "connected";
  readonly sent: ClientMessage[] = [];
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  send(message: ClientMessage) {
    this.sent.push(message);
  }
  onMessage(listener: (m: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatusChange() {
    return () => {};
  }
  deliver(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

const GAME_UT = 89_294;

function setup() {
  const clock = new ManualClock();
  const transport = new ModTransport();
  const client = new TelemetryClient(transport, clock);
  client.setDelaySource(() => 0);
  transport.deliver({
    type: "stream-data",
    topic: "time.warp",
    payload: { paused: false },
    meta: makeMeta({ deliveredAt: GAME_UT }),
  });
  return { clock, transport, client };
}

/** Sends a command and has the mod accept it with a reply predicted at the game's current UT. */
function sendAccepted(
  client: TelemetryClient,
  transport: ModTransport,
  label: string,
) {
  const sent = client.dispatch("x.y", {}, label);
  sent.result.catch(() => undefined);
  transport.deliver({
    type: "command-accepted",
    requestId: sent.requestId,
    predictedReplyUt: GAME_UT,
  });
  return sent.requestId;
}

describe("a command whose answer arrives after a scene load", () => {
  it("is not given up on while the game is loading and no game time passes", () => {
    const { clock, transport, client } = setup();
    const id = sendAccepted(client, transport, "Auto");

    transport.deliver({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
    });
    clock.advance(5);
    transport.deliver({ type: "game-state", state: "ready", scene: "FLIGHT" });
    transport.deliver({
      type: "command-response",
      requestId: id,
      result: "ok",
      meta: makeMeta(),
    });

    expect(client.getCommand(id).phase).toBe("confirmed");
  });

  it("is still given up on when the game runs and nothing answers", () => {
    const { clock, transport, client } = setup();
    const id = sendAccepted(client, transport, "Auto");

    clock.advance(4);

    expect(client.getCommand(id).phase).toBe("lost");
  });
});

describe("useCommand counting losses that are answered later", () => {
  it("counts each late answer once when several arrive before a re-render", async () => {
    const { clock, transport, client } = setup();
    function Control() {
      const command = useCommand("x.y", { rail: false });
      return (
        <>
          <button type="button" onClick={() => void command.send({})}>
            send
          </button>
          <output>{command.founds.length}</output>
        </>
      );
    }
    render(
      <TelemetryProvider client={client}>
        <Control />
      </TelemetryProvider>,
    );

    for (let i = 0; i < 4; i++) {
      act(() => {
        screen.getByRole("button").click();
      });
      const request = transport.sent.filter(
        (m) => m.type === "command-request",
      )[i];
      act(() => {
        transport.deliver({
          type: "command-accepted",
          requestId: (request as { requestId: string }).requestId,
          predictedReplyUt: GAME_UT,
        });
      });
    }
    await act(async () => {
      clock.advance(4);
    });

    const ids = transport.sent
      .filter((m) => m.type === "command-request")
      .map((m) => (m as { requestId: string }).requestId);
    act(() => {
      for (const id of ids) {
        transport.deliver({
          type: "command-response",
          requestId: id,
          result: { success: false, errorCode: "wrongState" },
          meta: makeMeta(),
        });
      }
    });

    expect(screen.getByRole("status").textContent).toBe("4");
  });
});
