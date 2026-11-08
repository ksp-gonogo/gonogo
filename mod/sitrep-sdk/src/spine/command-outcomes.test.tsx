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

function Outcomes({ command, name }: { command: string; name: string }) {
  const handle = useCommand(command, { rail: false });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void handle.dangerouslySendWithoutInput(
            { row: name },
            { label: name },
          )
        }
      >
        send {name}
      </button>
      <button
        type="button"
        onClick={() => handle.dismiss(handle.refusals[0]?.id ?? "")}
      >
        dismiss {name}
      </button>
      <output aria-label={`refusals ${name}`}>
        {handle.refusals.map((r) => r.label).join(",")}
      </output>
      <output aria-label={`founds ${name}`}>{handle.founds.length}</output>
    </>
  );
}

const lastRequestId = (transport: ModTransport) =>
  (
    transport.sent.filter((m) => m.type === "command-request").at(-1) as {
      requestId: string;
    }
  ).requestId;

const refuse = (transport: ModTransport, requestId: string) =>
  transport.deliver({
    type: "command-response",
    requestId,
    result: { success: false, errorCode: "wrongState" },
    meta: makeMeta(),
  });

describe("command outcomes held on the client", () => {
  it("shows a refusal to a widget mounted after the one that sent the command is gone", async () => {
    const { transport, client } = setup();
    const first = render(
      <TelemetryProvider client={client}>
        <Outcomes command="x.y" name="a" />
      </TelemetryProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "send a" }).click();
    });
    const id = lastRequestId(transport);
    first.unmount();

    await act(async () => refuse(transport, id));

    render(
      <TelemetryProvider client={client}>
        <Outcomes command="x.y" name="b" />
      </TelemetryProvider>,
    );
    expect(screen.getByLabelText("refusals b").textContent).toBe("a");
  });

  it("promotes a loss to a found with no widget mounted", async () => {
    const { clock, transport, client } = setup();
    const first = render(
      <TelemetryProvider client={client}>
        <Outcomes command="x.y" name="a" />
      </TelemetryProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "send a" }).click();
    });
    const id = lastRequestId(transport);
    act(() => {
      transport.deliver({
        type: "command-accepted",
        requestId: id,
        predictedReplyUt: GAME_UT,
      });
    });
    await act(async () => clock.advance(4));
    first.unmount();

    await act(async () => refuse(transport, id));

    render(
      <TelemetryProvider client={client}>
        <Outcomes command="x.y" name="b" />
      </TelemetryProvider>,
    );
    expect(screen.getByLabelText("founds b").textContent).toBe("1");
  });

  it("gives rows that share a command each other's outcomes, told apart by label and args, and none to another command", async () => {
    const { transport, client } = setup();
    render(
      <TelemetryProvider client={client}>
        <Outcomes command="x.y" name="a" />
        <Outcomes command="x.y" name="b" />
        <Outcomes command="other" name="c" />
      </TelemetryProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "send a" }).click();
    });
    const id = lastRequestId(transport);
    await act(async () => refuse(transport, id));

    expect(screen.getByLabelText("refusals a").textContent).toBe("a");
    expect(screen.getByLabelText("refusals b").textContent).toBe("a");
    expect(screen.getByLabelText("refusals c").textContent).toBe("");

    act(() => {
      screen.getByRole("button", { name: "dismiss b" }).click();
    });
    expect(screen.getByLabelText("refusals a").textContent).toBe("");
  });
});
