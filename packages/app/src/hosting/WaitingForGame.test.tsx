import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSitrepRuntimeForTests } from "../telemetry/sitrepRuntime";
import { WaitingForGame } from "./WaitingForGame";

afterEach(() => {
  vi.useRealTimers();
  resetSitrepRuntimeForTests();
});

describe("WaitingForGame", () => {
  it("offers the game's address before any wait", () => {
    render(<WaitingForGame />);
    expect(screen.getByLabelText("Game host")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try this address" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No answer from the game yet.")).toBeNull();
  });

  it("says the game has not answered after a long wait", async () => {
    vi.useFakeTimers();
    render(<WaitingForGame longWaitMs={50} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(screen.getByText("No answer from the game yet.")).toBeVisible();
  });
});
