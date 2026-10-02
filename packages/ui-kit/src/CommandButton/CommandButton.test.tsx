import { CommandErrorCode, railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandLossSentence } from "../CommandDelay/commandLossSentence";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import { emittedStateRuleFor } from "../test/emittedRule";
import {
  ARM_TIMEOUT_MS,
  CommandButton,
  type CommandButtonHandle,
  type CommandReplyLike,
  REFUSAL_TIMEOUT_MS,
  useCommandButton,
} from "./CommandButton";

// The rail axes come from the production derivation, so the fixture follows it rather than asserting a stale literal.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");

/** What a confirmed dispatch resolves with, as the wire answers it: a `CommandResult` envelope. */
const OK: CommandReplyLike = { success: true };

/** A hand-built handle satisfying the structural `CommandButtonHandle`; only the dispatch is a fixture. */
function makeHandle(
  send: CommandButtonHandle["send"],
  over: Partial<CommandButtonHandle> = {},
): CommandButtonHandle {
  return {
    send,
    inFlight: [],
    tags: RAIL_DISCRETE,
    effectiveDelaySeconds: 0,
    ...over,
  };
}

type Deferred<Reply = CommandReplyLike> = ReturnType<typeof deferred<Reply>>;

/** A dispatch the test settles by hand, which is what a delay window IS. */
function deferred<Reply = CommandReplyLike>() {
  let resolve!: (v: Reply) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Reply>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Keeps a test that never settles from warning about an unhandled rejection.
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

/** `shouldAdvanceTime`, because `userEvent`'s pointer sequencing waits on real time and a frozen clock hangs the click. */
function useArmClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

// Unconditional, so a test that fails before its own restore cannot leave the clock frozen for the rest of the file.
afterEach(() => {
  vi.useRealTimers();
});

describe("CommandButton: single-click dispatch", () => {
  it("dispatches on one click when no confirmLabel is given", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
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
    const send = vi.fn(() => Promise.resolve(OK));
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
  it("keeps one width across its resting and armed words, so arming it never reflows its row", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <CommandButton
        handle={makeHandle(send)}
        label="Fire"
        confirmLabel="Confirm"
      />,
    );
    const resting = screen.getByRole("button", { name: "Fire" });
    expect(resting.dataset.restLabel).toBe("Fire");
    expect(resting.dataset.armedLabel).toBe("Confirm");

    await user.click(resting);

    const armed = screen.getByRole("button", { name: "Confirm" });
    expect(armed.dataset.restLabel).toBe("Fire");
    expect(armed.dataset.armedLabel).toBe("Confirm");
  });

  it("reserves no width for a one-press control", () => {
    render(
      <CommandButton
        handle={makeHandle(vi.fn(() => Promise.resolve(OK)))}
        label="Stage"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Stage" }).dataset.restLabel,
    ).toBeUndefined();
  });

  it("arms on the first click and dispatches nothing", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
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
    const send = vi.fn(() => Promise.resolve(OK));
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
    const send = vi.fn(() => Promise.resolve(OK));
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
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).toHaveAttribute("data-command-phase", "pending");

    // Nothing has come back, and the control must not pretend otherwise.
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Going/ })).toBeInTheDocument();

    await act(async () => {
      d.resolve(OK);
    });
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("draws only a spinner in flight, over the resting label held invisible for its width", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="Launch vessel"
        pendingLabel="Launching..."
      />,
    );

    await user.click(screen.getByRole("button", { name: "Launch vessel" }));

    const pending = await screen.findByRole("button", { name: "Launching..." });
    expect(pending).toHaveAttribute("data-tooltip", "Launching...");
    expect(pending).not.toHaveTextContent("Launching...");
    const hold = [...pending.querySelectorAll("[aria-hidden='true']")].find(
      (el) => el.textContent === "Launch vessel",
    );
    expect(hold).toBeDefined();
    expect(getComputedStyle(hold as Element).visibility).toBe("hidden");
    await act(async () => {
      d.resolve(OK);
    });
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
      d.resolve(OK);
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
      d.resolve(OK);
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  // The resolved value is the only place a de-duplicated repeat is distinguishable from a fresh write.
  it("hands onConfirmed what the dispatch resolved with", async () => {
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

    // The envelope, with the command's own receipt on `payload`, where the wire puts it.
    const reply = { success: true, payload: { replayed: true } };

    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.resolve(reply);
    });

    expect(onConfirmed).toHaveBeenCalledWith(reply);
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
      d.resolve(OK);
    });
    // No act warning and no throw is the assertion; the row simply left.
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CommandButton: outcomes are announced, not only relabelled", () => {
  /** The control's own announcer: a hidden polite region beside it. */
  function announcer(container: HTMLElement): HTMLElement {
    return container.querySelector("[data-live-region]") as HTMLElement;
  }

  it("says a refusal in a region that was there before it", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { container } = render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        commandLabel="Upgrade Launch Pad"
        label="Upgrade"
      />,
    );
    const region = announcer(container);
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    await act(async () => {
      d.reject(
        refusalError(9, {
          command: "career.facility.upgrade",
          label: "Upgrade Launch Pad",
          breach: { limit: 3, actual: 3, unit: "", quantity: "tier" },
        }),
      );
    });

    expect(announcer(container)).toBe(region);
    expect(region).toHaveTextContent(/Upgrade Launch Pad refused/);
  });

  it("says a loss", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { container } = render(
      <CommandButton handle={makeHandle(() => d.promise)} label="Go" />,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(announcer(container)).toHaveTextContent(/no reply/i);
  });

  it("says nothing at rest", () => {
    const { container } = render(
      <CommandButton
        handle={makeHandle(() => deferred().promise)}
        label="Go"
      />,
    );
    expect(announcer(container)).toBeEmptyDOMElement();
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
    expect(button.getAttribute("data-tooltip")).toMatch(
      /Upgrade Launch Pad refused/,
    );
  });

  // The game's own `detail` must survive the refusal path too; without a `LimitBreach` it is the only clause there is.
  it("quotes the game's own reason when the refusal carried one", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        commandLabel="Arm the write surface"
        label="ARM WRITES"
      />,
    );

    await user.click(screen.getByRole("button", { name: "ARM WRITES" }));
    await act(async () => {
      // ModeUnavailable, whose general clause is "the game would not say why".
      d.reject(
        refusalError(3, {
          command: "plan.arm",
          label: "Arm the write surface",
          detail:
            "the plugin is not running right now (main menu, or mid-reset)",
        }),
      );
    });

    const button = await screen.findByRole("button", { name: /refused/i });
    expect(button.getAttribute("data-tooltip")).toBe(
      "Arm the write surface refused: the plugin is not running right now " +
        "(main menu, or mid-reset).",
    );
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

    const button = screen.getByRole("button");
    expect(button).not.toHaveTextContent("Refused");
    expect(button).toHaveAttribute("data-command-phase", "lost");
  });

  // A dropped command must not settle to `idle`, where it would look exactly like one that ran.
  it("does not settle a dropped command the way it settles a confirmed one", async () => {
    async function settledPhase(settle: (d: Deferred) => void) {
      const user = userEvent.setup();
      const d = deferred();
      const { unmount } = render(
        <CommandButton handle={makeHandle(() => d.promise)} label="Go" />,
      );
      await user.click(screen.getByRole("button", { name: "Go" }));
      await act(async () => {
        settle(d);
      });
      const button = screen.getByRole("button");
      const state = {
        phase: button.getAttribute("data-command-phase"),
        text: button.textContent,
      };
      unmount();
      return state;
    }

    const confirmed = await settledPhase((d) => d.resolve(OK));
    const dropped = await settledPhase((d) =>
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" })),
    );

    expect(confirmed).toEqual({ phase: "idle", text: "Go" });
    expect(dropped).not.toEqual(confirmed);
    expect(dropped.text).toMatch(/no reply/i);
  });

  it("returns a dropped command's control to rest once the loss has been read", async () => {
    const user = useArmClock();
    const d = deferred();
    render(<CommandButton handle={makeHandle(() => d.promise)} label="Go" />);

    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(screen.getByRole("button")).toHaveTextContent(/no reply/i);

    await act(async () => {
      vi.advanceTimersByTime(REFUSAL_TIMEOUT_MS + 1);
    });
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
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
        handle={makeHandle(() => Promise.resolve(OK))}
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

    // Still announcing "Hire ..." after arming would tell a screen-reader user nothing happened.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("uses the caller's confirm name when it has one", async () => {
    const user = userEvent.setup();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK))}
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
        handle={makeHandle(() => Promise.resolve(OK))}
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
        handle={makeHandle(() => Promise.resolve(OK))}
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
      d.resolve(OK);
    });
  });
});

describe("CommandButton: an unanswered or unsent command echoes on the control that issued it", () => {
  it("carries data-unconfirmed, never data-failed, while the handle holds an overdue dispatch", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
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
    const button = screen.getByRole("button", { name: "Hire" });
    expect(button).toHaveAttribute("data-unconfirmed", "true");
    expect(button).not.toHaveAttribute("data-failed");
  });

  it("carries data-failed while the handle holds a dispatch that never left", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          undelivered: [{ id: "u1", command: "career.crew.hire", label: "" }],
        })}
        label="Hire"
      />,
    );
    const button = screen.getByRole("button", { name: "Hire" });
    expect(button).toHaveAttribute("data-failed", "true");
    expect(button).not.toHaveAttribute("data-unconfirmed");
  });
});

describe("CommandButton: the blocked phase", () => {
  /** A gate the mod has already decided, in the shape `useCommand.gate` returns. */
  function blockedGate(over: Record<string, unknown> = {}) {
    return {
      blocked: true,
      errorCode: CommandErrorCode.SiteOccupied,
      detail: "Launch Pad is occupied",
      ...over,
    };
  }

  it("dispatches nothing when the game has already said it will refuse", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <CommandButton
        handle={makeHandle(send, { gate: blockedGate() })}
        label="Launch"
      />,
    );

    await user.click(screen.getByRole("button"));

    expect(send).not.toHaveBeenCalled();
  });

  it("draws from the verdict for the item its own args name", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const handle = makeHandle(send, {
      gateFor: (args) =>
        typeof args === "object" &&
        args !== null &&
        "facilityId" in args &&
        args.facilityId === "LaunchPad"
          ? blockedGate({ detail: "short of funds" })
          : { blocked: false, errorCode: CommandErrorCode.ModeUnavailable },
    });
    render(
      <>
        <CommandButton
          handle={handle}
          args={{ facilityId: "LaunchPad" }}
          label="Upgrade pad"
        />
        <CommandButton
          handle={handle}
          args={{ facilityId: "Runway" }}
          label="Upgrade runway"
        />
      </>,
    );

    const pad = screen.getByRole("button", { name: /pad|short of funds/i });
    const runway = screen.getByRole("button", { name: "Upgrade runway" });
    expect(pad).toHaveAttribute("data-gate", "blocked");
    expect(runway).not.toHaveAttribute("data-gate");

    await user.click(pad);
    expect(send).not.toHaveBeenCalled();
    await user.click(runway);
    expect(send).toHaveBeenCalledWith({ facilityId: "Runway" }, undefined);
  });

  it("is aria-disabled and NOT disabled, so a screen reader still finds it", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK))}
        label="Launch"
      />,
    );
    const ungated = screen.getByRole("button");
    expect(ungated).not.toHaveAttribute("aria-disabled");
    expect(ungated).not.toBeDisabled();

    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate(),
        })}
        label="Launch"
        commandLabel="Launch Kerbal I"
      />,
    );
    const gated = screen.getAllByRole("button")[1];
    expect(gated).toHaveAttribute("aria-disabled", "true");
    // `disabled` would drop it from some screen readers' walk, leaving nothing where the reason should be.
    expect(gated).not.toBeDisabled();
  });

  it("makes the REASON the accessible name, not just the fact", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate(),
        })}
        label="Launch"
        commandLabel="Launch Kerbal I"
        aria-label="Launch Kerbal I"
      />,
    );

    // The game's own words, through the shared composer.
    expect(
      screen.getByRole("button", {
        name: "Launch Kerbal I unavailable: Launch Pad is occupied.",
      }),
    ).toBeInTheDocument();
  });

  it("quotes the numbers when the gate carried a breach", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate({
            // CommandErrorCode.LimitReached
            errorCode: CommandErrorCode.LimitReached,
            detail: "",
            breach: {
              facility: "AstronautComplex",
              facilityName: "Astronaut Complex",
              facilityLevel: { magnitude: 0, unit: "ratio" },
              quantity: "activeCrew",
              limit: 16,
              actual: 16,
              unit: "count",
            },
          }),
        })}
        label="Hire"
        commandLabel="Hire Valentina Kerman"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Hire Valentina Kerman unavailable: the Astronaut Complex holds 16 of 16 active crew.",
      }),
    ).toBeInTheDocument();
  });

  it("shows the reason in the control on a press, for the keyboard user a title never reaches", async () => {
    const user = userEvent.setup();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate(),
        })}
        label="Launch"
        commandLabel="Launch Kerbal I"
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Launch");

    await user.click(button);

    expect(button).toHaveTextContent(
      "Launch Kerbal I unavailable: Launch Pad is occupied.",
    );
  });

  it("puts the reason away again, since the condition the game named can change", async () => {
    const user = useArmClock();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate(),
        })}
        label="Launch"
      />,
    );

    const button = screen.getByRole("button");
    await user.click(button);
    expect(button).toHaveTextContent(/Unavailable: Launch Pad is occupied/);

    await act(async () => {
      vi.advanceTimersByTime(REFUSAL_TIMEOUT_MS + 10);
    });

    expect(button).toHaveTextContent("Launch");
  });

  it("comes back to life the moment the gate opens", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const { rerender } = render(
      <CommandButton
        handle={makeHandle(send, { gate: blockedGate() })}
        label="Launch"
      />,
    );

    rerender(
      <CommandButton
        handle={makeHandle(send, {
          gate: { blocked: false, errorCode: CommandErrorCode.ModeUnavailable },
        })}
        label="Launch"
      />,
    );

    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    expect(send).toHaveBeenCalledOnce();
  });

  it("leaves an ungated handle exactly as it was, so nothing changes for a command with no gates", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(<CommandButton handle={makeHandle(send)} label="Launch" />);

    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("lets an in-flight dispatch finish rather than reading as blocked behind it", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { rerender } = render(
      <CommandButton handle={makeHandle(() => d.promise)} label="Launch" />,
    );

    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");

    // The gate shuts behind the command that is already travelling.
    rerender(
      <CommandButton
        handle={makeHandle(() => d.promise, { gate: blockedGate() })}
        label="Launch"
      />,
    );

    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "pending",
    );

    await act(async () => {
      d.resolve(OK);
    });
  });

  it("leaves a control the mod could not judge alone, since sandbox nulls one authority", async () => {
    // In a sandbox save every facility gate answers Unknown, so darkening on it would black out working controls.
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <CommandButton
        handle={makeHandle(send, {
          gate: {
            blocked: false,
            undetermined: true,
            command: "career.tech.unlock",
            errorCode: CommandErrorCode.ModeUnavailable,
            detail: "the facilities scenario is not loaded",
          },
        })}
        label="Unlock"
      />,
    );

    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveTextContent("Unlock");
    // Reported for a diagnostic surface, never to the operator.
    expect(button).toHaveAttribute("data-gate", "undetermined");

    await user.click(button);
    // The dispatch is the authority when the console could not tell.
    expect(send).toHaveBeenCalledOnce();
  });

  it("has no axe violations while blocked", async () => {
    const { container } = render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: blockedGate(),
        })}
        label="Launch"
        commandLabel="Launch Kerbal I"
      />,
    );

    await expectNoA11yViolations(container);
  });
});

describe("CommandButton: accessibility", () => {
  let container: HTMLElement;

  beforeEach(() => {
    ({ container } = render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK))}
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

/**
 * The reversal: a `lost` command can turn up executed, and the control that
 * issued it is where an operator about to re-send is looking. The handle is the
 * channel, since the dispatch promise already rejected as `E_LOST`.
 */
describe("CommandButton: a lost command that answered after all", () => {
  const RAN: NonNullable<CommandButtonHandle["founds"]> = [
    {
      id: "c0",
      command: "vessel.control.setSas",
      args: { enabled: true },
      label: "",
      outcome: "ran",
    },
  ];

  async function loseThenFind(
    founds: NonNullable<CommandButtonHandle["founds"]> = RAN,
  ) {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const { rerender } = render(
      <CommandButton handle={makeHandle(send)} label="SAS" />,
    );
    await user.click(screen.getByRole("button", { name: "SAS" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "lost",
    );
    // The late reply lands: `useCommand` promotes the loss to a found on the handle.
    await act(async () => {
      rerender(
        <CommandButton handle={makeHandle(send, { founds })} label="SAS" />,
      );
    });
    return { user, send };
  }

  it("says what it did, and never confirmed, when the lost command answers", async () => {
    await loseThenFind();
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-command-phase", "found");
    expect(button).toHaveAccessibleName(/ran\./i);
    // Must not read like a confirmation to someone deciding whether to send it again.
    expect(button).not.toHaveTextContent(/confirmed/i);
  });

  it("carries the whole sentence on the accessible name, as the lost phase does", async () => {
    // The visible word is only "Found", so the accessible name carries the subject and the verdict.
    await loseThenFind();
    const button = screen.getByRole("button");
    const name = button.getAttribute("aria-label") ?? "";
    expect(name).toMatch(/^Set Sas ran\.$/);
  });

  it("says a late refusal was refused, not that it ran", async () => {
    await loseThenFind([
      {
        id: "c0",
        command: "career.crew.hire",
        args: undefined,
        label: "Hire Valentina Kerman",
        outcome: "refused",
        errorCode: CommandErrorCode.LimitReached,
      },
    ]);
    const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(name).toMatch(/was refused/i);
    expect(name).not.toMatch(/ ran\./i);
  });

  it("does NOT claim a found for a control that never lost anything", async () => {
    // One handle serves many rows; a found belongs only to the row that lost the command.
    const send = vi.fn(async () => OK);
    const { rerender } = render(
      <CommandButton handle={makeHandle(send)} label="SAS" />,
    );
    await act(async () => {
      rerender(
        <CommandButton
          handle={makeHandle(send, { founds: RAN })}
          label="SAS"
        />,
      );
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });

  it("clears on a press, so the operator can send again from rest", async () => {
    const { user, send } = await loseThenFind();
    await user.click(screen.getByRole("button", { name: /ran\./i }));
    expect(screen.getByRole("button", { name: "SAS" })).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
    // The press clears rather than re-dispatching; the rail holds the found until dismissed.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations while found", async () => {
    await loseThenFind();
    await expectNoA11yViolations(document.body);
  });
});

describe("CommandButton warning text", () => {
  it("draws an unconfirmed or failed control's label and a blocked control's hover in the warning colour made for a dark ground", () => {
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK), {
          gate: {
            blocked: true,
            errorCode: CommandErrorCode.NoConnection,
            detail: "Launch Pad is occupied",
          },
        })}
        label="Launch"
      />,
    );
    const button = screen.getByRole("button");
    for (const selector of [
      '[data-unconfirmed="true"]',
      '[data-failed="true"]',
      ":hover:not(:disabled)",
    ]) {
      const rule = emittedStateRuleFor(button, selector);
      expect(rule, selector).toContain("var(--color-warn-text)");
    }
  });
});

describe("CommandButton keeps keyboard focus through a dispatch", () => {
  it("stays focused while pending, so the outcome lands on the control the operator is on", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <CommandButton
        handle={makeHandle(() => d.promise)}
        label="Go"
        pendingLabel="Going..."
      />,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    const pending = await screen.findByRole("button", { name: /Going/ });
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    await act(async () => {
      d.resolve(OK);
    });
  });
});

describe("useCommandButton's loss sentence", () => {
  function Custom({ handle }: { handle: CommandButtonHandle }) {
    const state = useCommandButton({ handle, commandLabel: "Stage" });
    return (
      <>
        <button type="button" onClick={() => state.press(false)}>
          custom
        </button>
        <output>{state.lossText ?? "none"}</output>
      </>
    );
  }

  it("hands a custom control the same sentence CommandButton speaks for a loss", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(<Custom handle={makeHandle(() => d.promise)} />);
    expect(screen.getByRole("status")).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "custom" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      commandLossSentence({ label: "Stage" }),
    );
  });
});

type PressReady = (press: ((armable: boolean) => void) | null) => void;

describe("CommandButton onPressReady", () => {
  it("lists a press while a click would act and withdraws it while the command is in flight", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const onPressReady = vi.fn<PressReady>();
    render(
      <CommandButton
        handle={makeHandle(send)}
        label="Stage"
        onPressReady={onPressReady}
      />,
    );
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeTypeOf("function");

    await user.click(screen.getByRole("button", { name: "Stage" }));
    expect(send).toHaveBeenCalledOnce();
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeNull();

    await act(async () => {
      d.resolve(OK);
    });
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeTypeOf("function");
  });

  it("presses the control from the listed press, arming before it dispatches", async () => {
    const send = vi.fn(() => Promise.resolve(OK));
    const onPressReady = vi.fn<PressReady>();
    render(
      <CommandButton
        handle={makeHandle(send)}
        label="Recover"
        confirmLabel="Confirm recover"
        onPressReady={onPressReady}
      />,
    );
    const listed = () => {
      const press = onPressReady.mock.calls.at(-1)?.[0];
      if (!press) throw new Error("no press listed");
      return press;
    };
    act(() => listed()(true));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("Confirm recover");
    act(() => listed()(true));
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {});
  });
});

describe("CommandButton icon", () => {
  it("names the control by its word and keeps the word as the name when armed", async () => {
    const user = userEvent.setup();
    render(
      <CommandButton
        handle={makeHandle(() => Promise.resolve(OK))}
        label="Upgrade"
        confirmLabel="Confirm"
        icon={<svg data-testid="up" />}
        confirmIcon={<svg data-testid="check" />}
      />,
    );
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();
    await act(async () => {});
  });
});
