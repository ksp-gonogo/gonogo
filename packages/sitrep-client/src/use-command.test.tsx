import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useCommand } from "./use-command";

function Deploy() {
  const { send, status } = useCommand("deploy");
  return (
    <div>
      <button type="button" onClick={() => send(9)}>
        go
      </button>
      <span>phase:{status.phase}</span>
    </div>
  );
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
});
