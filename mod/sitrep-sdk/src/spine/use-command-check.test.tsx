// @vitest-environment jsdom

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateOutcome } from "../__generated__/contract";
import { act, render, screen } from "../testing";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { GATE_CHECK_COMMAND, GATE_CHECK_DEBOUNCE_MS } from "./gate-check";
import { useCommand } from "./use-command";

const FAR = {
  success: true,
  payload: {
    outcome: GateOutcome.Fail,
    errorCode: "outOfReach",
    detail: "the far centre is outside the pad's system",
  },
};

function Probe({ site }: { site: string }) {
  const launch = useCommand("ksp.launch", { rail: false });
  const args = { site } as never;
  const { check } = launch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the choice is the trigger
  useEffect(() => void check?.(args), [check, site]);
  const gate = launch.gateFor(args);
  return <p>{gate?.blocked ? `blocked: ${gate.detail}` : "live"}</p>;
}

describe("useCommand(...).check", () => {
  let dispatch: ReturnType<typeof vi.spyOn>;
  let client: TelemetryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new TelemetryClient(new StubTransport());
    dispatch = vi.spyOn(client, "dispatch").mockImplementation(
      () =>
        ({
          requestId: "r1",
          result: Promise.resolve(FAR),
        }) as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mount(site: string) {
    return (
      <TelemetryProvider client={client}>
        <Probe site={site} />
      </TelemetryProvider>
    );
  }

  it("asks the mod once the choice has settled and draws the verdict's own reason", async () => {
    render(mount("LaunchPad"));
    expect(screen.getByText("live")).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATE_CHECK_DEBOUNCE_MS);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toBe(GATE_CHECK_COMMAND);
    expect(dispatch.mock.calls[0]?.[1]).toEqual({
      command: "ksp.launch",
      args: { site: "LaunchPad" },
    });
    expect(
      screen.getByText("blocked: the far centre is outside the pad's system"),
    ).toBeTruthy();
  });

  it("asks once for a burst of changes, about the last one", async () => {
    const { rerender } = render(mount("A"));
    rerender(mount("B"));
    rerender(mount("C"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATE_CHECK_DEBOUNCE_MS);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[1]).toEqual({
      command: "ksp.launch",
      args: { site: "C" },
    });
  });

  it("draws a verdict only for the choice it was asked about", async () => {
    const { rerender } = render(mount("LaunchPad"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATE_CHECK_DEBOUNCE_MS);
    });
    expect(screen.getByText(/^blocked/)).toBeTruthy();

    rerender(mount("Runway"));

    expect(screen.getByText("live")).toBeTruthy();
  });
});
