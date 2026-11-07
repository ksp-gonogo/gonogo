// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "../testing";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { useCommand } from "./use-command";

function Control() {
  const command = useCommand("x.y", { rail: false });
  return (
    <button type="button" onClick={() => void command.send({})}>
      {command.status.phase}
    </button>
  );
}

function mount(client: TelemetryClient) {
  return (
    <TelemetryProvider client={client}>
      <Control />
    </TelemetryProvider>
  );
}

describe("useCommand after its client is replaced", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads idle from the new client instead of looping on a request it never saw", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = new TelemetryClient(new StubTransport());
    const second = new TelemetryClient(new StubTransport());
    const { rerender } = render(mount(first));

    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.getByRole("button").textContent).not.toBe("idle");

    rerender(mount(second));

    expect(screen.getByRole("button").textContent).toBe("idle");
    expect(errors).not.toHaveBeenCalled();
  });

  it("returns one idle status for every id it does not know", () => {
    const client = new TelemetryClient(new StubTransport());
    expect(client.getCommand("never-sent")).toBe(client.getCommand("other"));
  });
});
