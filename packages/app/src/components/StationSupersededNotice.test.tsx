import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { StationSupersededNotice } from "./StationSupersededNotice";

function fakeClient() {
  let superseded = false;
  const listeners = new Set<(value: boolean) => void>();
  return {
    isSuperseded: () => superseded,
    onSuperseded(cb: (value: boolean) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    takeBack: vi.fn(),
    set(value: boolean) {
      superseded = value;
      for (const cb of listeners) cb(value);
    },
  };
}

describe("StationSupersededNotice", () => {
  it("shows nothing while this page holds the station", () => {
    render(<StationSupersededNotice client={fakeClient()} />);
    expect(
      screen.queryByText("This station is open in another tab"),
    ).toBeNull();
  });

  it("says another tab has the station and takes it back on the one control", async () => {
    const client = fakeClient();
    const { container } = render(<StationSupersededNotice client={client} />);
    act(() => client.set(true));
    expect(
      screen.getByText("This station is open in another tab"),
    ).not.toBeNull();
    await expectNoA11yViolations(container);

    act(() => screen.getByRole("button", { name: "Use this tab" }).click());
    expect(client.takeBack).toHaveBeenCalledTimes(1);

    act(() => client.set(false));
    expect(
      screen.queryByText("This station is open in another tab"),
    ).toBeNull();
  });
});
