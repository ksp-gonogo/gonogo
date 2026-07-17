import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import type { Transport, TransportStatus } from "./transport";
import { useCommand } from "./use-command";

function Deploy() {
  const { send, status } = useCommand("deploy");
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Fire-and-forget from a click handler, same as most real
          // dispatch call sites; `status` is what the test observes, not
          // the promise, but it still must be caught to avoid an unhandled
          // rejection when a command loses/errors.
          send(9).catch(() => {});
        }}
      >
        go
      </button>
      <span>phase:{status.phase}</span>
      <span>
        eta:{status.phase === "in-flight" ? status.etaConfirm : "none"}
      </span>
    </div>
  );
}

/** See client.test.ts for the identical double — kept local here so this
 * test file stays self-contained. */
class FakeClock implements Clock {
  private currentUt: number;
  private pending: { atUt: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(startUt = 0) {
    this.currentUt = startUt;
  }

  now(): number {
    return this.currentUt;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const callback = { atUt, fn, cancelled: false };
    this.pending.push(callback);
    return () => {
      callback.cancelled = true;
    };
  }

  advanceTo(ut: number): void {
    this.currentUt = ut;
    const due = this.pending.filter((cb) => !cb.cancelled && cb.atUt <= ut);
    this.pending = this.pending.filter((cb) => cb.cancelled || cb.atUt > ut);
    for (const cb of due) cb.fn();
  }
}

class EtaTransport implements Transport {
  readonly status: TransportStatus = "connected";
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();

  constructor(private readonly eta: number | undefined) {}

  predictConfirmEta(): number | undefined {
    return this.eta;
  }

  send(): void {
    // Test drives responses manually (none needed for these loss tests).
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(): () => void {
    return () => {};
  }
}

describe("useCommand", () => {
  it("fires a command and reflects the lifecycle to confirmed", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c, a) => ({ c, a }));
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    expect(screen.getByText("phase:idle")).toBeTruthy();
    fireEvent.click(screen.getByText("go"));
    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );
  });

  it("surfaces the predicted etaConfirm while in-flight", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("eta:4")).toBeTruthy();
  });

  it("surfaces lost after silence past etaConfirm + LOSS_MARGIN", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    fireEvent.click(screen.getByText("go"));

    // clock.advanceTo synchronously fires the loss-inference callback,
    // which synchronously updates the store — same as any direct
    // setState-driving call, this needs an explicit act() (fireEvent
    // wraps this automatically; a bare test-double clock advance doesn't).
    act(() => {
      clock.advanceTo(4 + LOSS_MARGIN);
    });

    expect(screen.getByText("phase:lost")).toBeTruthy();
  });
});
