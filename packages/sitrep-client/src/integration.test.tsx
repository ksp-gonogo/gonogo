import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useCommand } from "./use-command";
import { useStream } from "./use-stream";

/**
 * Proof that one component can read a live telemetry stream
 * AND dispatch a command, both routed through the real
 * `TelemetryProvider` -> `TelemetryClient` -> `Transport` boundary, with only
 * the transport's other end (`StubTransport`) faked.
 */
function MissionPanel() {
  const altitude = useStream<number>("v.alt");
  const { send, status } = useCommand("stage");
  return (
    <div>
      <span>altitude:{altitude ?? "—"}</span>
      <button type="button" onClick={() => send()}>
        stage
      </button>
      <span>phase:{status.phase}</span>
    </div>
  );
}

describe("sitrep-client end-to-end spine", () => {
  it("streams live data and runs a command to confirmed through the real provider/client/stub", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler((command) => ({ command, staged: true }));
    const client = new TelemetryClient(transport);

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <MissionPanel />
      </TelemetryProvider>,
    );

    // Stream: renders, then updates on new inbound data. `TelemetryProvider`
    // coalesces `beginFrame()` to the next animation frame, so each update
    // lands one frame after its emit, not synchronously.
    expect(screen.getByText("altitude:—")).toBeTruthy();
    act(() => {
      transport.emit("v.alt", 1200);
    });
    await waitFor(() => expect(screen.getByText("altitude:1200")).toBeTruthy());
    act(() => {
      transport.emit("v.alt", 1450);
    });
    await waitFor(() => expect(screen.getByText("altitude:1450")).toBeTruthy());

    // Command: idle -> in-flight (observable synchronously right after the
    // click, before the stub's queued microtask response) -> confirmed.
    expect(screen.getByText("phase:idle")).toBeTruthy();
    fireEvent.click(screen.getByText("stage"));
    expect(screen.getByText("phase:in-flight")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );

    // Unmount releases the ref-counted stream subscription: the transport
    // should no longer consider "v.alt" subscribed.
    expect(transport.isSubscribed("v.alt")).toBe(true);
    unmount();
    expect(transport.isSubscribed("v.alt")).toBe(false);
  });
});
