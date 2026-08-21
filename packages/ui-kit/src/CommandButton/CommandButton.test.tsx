import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import {
  ARM_TIMEOUT_MS,
  CommandButton,
  type CommandButtonHandle,
  REFUSAL_TIMEOUT_MS,
} from "./CommandButton";

/**
 * A hand-built handle satisfying the structural `CommandButtonHandle`, the same
 * way `useCommand`'s real return value does. Nothing here mocks a ui-kit module:
 * the component under test runs whole, and only the dispatch it is handed is a
 * fixture.
 */
function makeHandle(
  send: CommandButtonHandle["send"],
  over: Partial<CommandButtonHandle> = {},
): CommandButtonHandle {
  return {
    send,
    inFlight: [],
    shape: "discrete",
    effectiveDelaySeconds: 0,
    ...over,
  };
}

/** A dispatch the test settles by hand, which is what a delay window IS. */
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The component attaches its own handlers, so an unhandled rejection is not
  // possible here; this keeps a test that never settles from warning anyway.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** The refusal shape `classifyCommandRejection` reads, structurally. */
function refusalError(errorCode: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error("refused"), {
    code: "E_REFUSED",
    errorCode,
    ...extra,
  });
}

/**
 * `shouldAdvanceTime`, not a bare `useFakeTimers()`: `userEvent`'s own pointer
 * sequencing waits on real time, so a frozen clock hangs the click that is meant
 * to arm the control and every later test inherits the frozen clock.
 */
function useArmClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

// Unconditional, so a test that fails before its own restore cannot leave the
// clock frozen for the rest of the file.
afterEach(() => {
  vi.useRealTimers();
});

describe("CommandButton: single-click dispatch", () => {
  it("dispatches on one click when no confirmLabel is given", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(undefined));
    render(
      <CommandButton handle={makeHandle(send)} args={{ id: "x" }} label="Go" />,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ id: "x" }, undefined);
    await act(async () => {});
  });

  it("passes commandLabel through as the dispatch label, so a refusal can name it", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(undefined));
    render(
      <CommandButton
        handle={makeHandle(send)}
        commandLabel="Hire Valentina Kerman"
        label="Hire"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hire" }));

    expect(send).toHaveBeenCalledWith(undefined, {
      label: "Hire Valentina Kerman",
    });
    await act(async () => {});
  });
});

describe("CommandButton: arm then confirm", () => {
  it("arms on the first click and dispatches nothing", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(undefined));
    render(
      <CommandButton
        handle={makeHandle(send)}
        label="Fire"
        confirmLabel="Confirm"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));

    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches on the second click", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(undefined));
    render(
      <CommandButton
        handle={makeHandle(send)}
        args="kerbal"
        label="Fire"
        confirmLabel="Confirm"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(send).toHaveBeenCalledWith("kerbal", undefined);
    await act(async () => {});
  });

  it("disarms itself after the arm window, so a forgotten arm does not sit live", async () => {
    const user = useArmClock();
    const send = vi.fn(() => Promise.resolve(undefined));
    render(
      <CommandButton
        handle={makeHandle(send)}
        label="Fire"
        confirmLabel="Confirm"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(ARM_TIMEOUT_MS + 1);
    });

    expect(screen.getByRole("button", { name: "Fire" })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("CommandButton: the in-flight window", () => {
  it("stays pending for as long as the dispatch is unanswered", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="Go"
        pendingLabel="Going..."
      />,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));

    const pending = await screen.findByRole("button", { name: /Going/ });
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("data-command-phase", "pending");

    // Nothing has come back, and the control must not pretend otherwise.
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Going/ })).toBeInTheDocument();

    await act(async () => {
      d.resolve(undefined);
    });
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("refuses a second dispatch while one is in flight", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    render(<CommandButton handle={makeHandle(send)} label="Go" />);

    await user.click(screen.getByRole("button", { name: "Go" }));
    await screen.findByRole("button", { name: /Working/ });
    await user.click(screen.getByRole("button", { name: /Working/ }));

    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve(undefined);
    });
  });

  it("calls onConfirmed once the dispatch is confirmed, and not before", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onConfirmed = vi.fn();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="Go"
        onConfirmed={onConfirmed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirmed).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve(undefined);
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("does not set state from a dispatch that settles after unmount", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { unmount } = render(
      <CommandButton handle={makeHandle(() => d.promise)} label="Go" />,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));
    unmount();

    await act(async () => {
      d.resolve(undefined);
    });
    // No act warning and no throw is the assertion; the row simply left.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CommandButton: the refused phase", () => {
  it("says the game refused, and why, without the caller deriving it", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        commandLabel="Upgrade Launch Pad"
        label="Upgrade"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    await act(async () => {
      // AlreadyAtMaximum, with the numbers the mod sent.
      d.reject(
        refusalError(9, {
          command: "career.facility.upgrade",
          label: "Upgrade Launch Pad",
          breach: { limit: 3, actual: 3, unit: "", quantity: "tier" },
        }),
      );
    });

    const button = await screen.findByRole("button", { name: /refused/i });
    expect(button).toHaveAttribute("data-command-phase", "refused");
    expect(button).toHaveTextContent("Refused");
    // The reason reaches the operator, rather than being discarded at the
    // line that refused.
    expect(button.getAttribute("title")).toMatch(/Upgrade Launch Pad refused/);
  });

  it("returns to rest after the refusal window, since the situation can change", async () => {
    const user = useArmClock();
    const d = deferred();
    render(
      <CommandButton handle={makeHandle(() => d.promise)} label="Upgrade" />,
    );

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    await act(async () => {
      d.reject(refusalError(9));
    });
    expect(
      screen.getByRole("button", { name: /refused/i }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(REFUSAL_TIMEOUT_MS + 1);
    });

    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
  });

  it("clears the refusal on a press rather than dispatching straight back into the same no", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    render(<CommandButton handle={makeHandle(send)} label="Upgrade" />);

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    await act(async () => {
      d.reject(refusalError(9));
    });

    await user.click(screen.getByRole("button", { name: /refused/i }));

    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not call a lost command refused: nothing was decided", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<CommandButton handle={makeHandle(() => d.promise)} label="Go" />);

    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });

    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("data-command-phase", "idle");
    expect(button).not.toHaveTextContent("Refused");
  });

  it("does not call a machinery failure refused either", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<CommandButton handle={makeHandle(() => d.promise)} label="Go" />);

    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(new Error("socket died"));
    });

    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });
});

describe("CommandButton: the accessible name tracks the phase", () => {
  it("does not keep announcing the resting name once armed", async () => {
    const user = userEvent.setup();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined))}
        label="Hire"
        confirmLabel="Confirm"
        aria-label="Hire Desdin Kerman for 30,000 funds"
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Hire Desdin Kerman for 30,000 funds",
      }),
    );

    // The press meant something; a control still announcing "Hire ..." has told
    // a screen-reader user nothing happened.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("uses the caller's confirm name when it has one", async () => {
    const user = userEvent.setup();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined))}
        label="Hire"
        confirmLabel="Confirm"
        aria-label="Hire Desdin Kerman"
        confirmAriaLabel="Confirm hire of Desdin Kerman"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Hire Desdin Kerman" }),
    );

    expect(
      screen.getByRole("button", { name: "Confirm hire of Desdin Kerman" }),
    ).toBeInTheDocument();
  });

  it("lets the refusal sentence be the name while a refusal stands", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="Upgrade"
        aria-label="Upgrade Launch Pad"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Upgrade Launch Pad" }),
    );
    await act(async () => {
      d.reject(
        refusalError(9, {
          command: "career.facility.upgrade",
          label: "Upgrade Launch Pad",
        }),
      );
    });

    expect(
      screen.getByRole("button", { name: /Upgrade Launch Pad refused/ }),
    ).toBeInTheDocument();
  });
});

describe("CommandButton: representing state as well as acting", () => {
  it("carries aria-pressed when it represents a current state", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined))}
        label="SAS"
        active
      />,
    );
    expect(screen.getByRole("button", { name: "SAS" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("carries no aria-pressed when it only acts", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined))}
        label="Hire"
      />,
    );
    expect(screen.getByRole("button", { name: "Hire" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("arms and goes pending exactly the same when it is a toggle", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="SAS"
        confirmLabel="Confirm SAS"
        pendingLabel="Setting..."
        active={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "SAS" }));
    await user.click(screen.getByRole("button", { name: "Confirm SAS" }));

    expect(
      await screen.findByRole("button", { name: /Setting/ }),
    ).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      d.resolve(undefined);
    });
  });
});

describe("CommandButton: a dead command echoes on the control that issued it", () => {
  it("carries data-failed while the handle holds an overdue dispatch", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined), {
          inFlight: [
            {
              id: "r1",
              command: "career.crew.hire",
              predictedPhase: "overdue",
            } as never,
          ],
        })}
        label="Hire"
      />,
    );
    expect(screen.getByRole("button", { name: "Hire" })).toHaveAttribute(
      "data-failed",
      "true",
    );
  });
});

describe("CommandButton: accessibility", () => {
  let container: HTMLElement;

  beforeEach(() => {
    ({ container } = render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(undefined))}
        label="Hire"
        confirmLabel="Confirm hire"
        active={false}
      />,
    ));
  });

  it("has no axe violations", async () => {
    await expectNoA11yViolations(container);
  });
});
