import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import {
  ARM_TIMEOUT_MS,
  CommandButton,
  type CommandButtonHandle,
  type CommandReplyLike,
  REFUSAL_TIMEOUT_MS,
} from "./CommandButton";

/**
 * What a confirmed dispatch resolves with, as the wire actually answers it.
 *
 * These fixtures used to resolve `undefined`, which is a reply no command has
 * ever sent: the mod answers a `CommandResult` envelope on every success. That
 * only typechecked while the handle's reply defaulted to `unknown`, and it is
 * the same absence that let seven controls read a receipt's fields off the
 * envelope carrying it.
 */
const OK: CommandReplyLike = { success: true };

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

type Deferred<T = CommandReplyLike> = ReturnType<typeof deferred<T>>;

/** A dispatch the test settles by hand, which is what a delay window IS. */
function deferred<T = CommandReplyLike>() {
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
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("data-command-phase", "pending");

    // Nothing has come back, and the control must not pretend otherwise.
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Going/ })).toBeInTheDocument();

    await act(async () => {
      d.resolve(OK);
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

  /**
   * The dispatch's own answer reaches the caller.
   *
   * A confirmed command is not always a command that DID something: a mod that
   * de-duplicates on request id answers a repeat with the receipt it stored the
   * first time, and that receipt is the only place the repeat is distinguishable
   * from a fresh write. Discarding the resolved value made every such reply read
   * as a fresh success, which is a widget saying the plan changed when it did
   * not.
   */
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

    // The envelope, with the command's own receipt on `payload`, which is where
    // the wire puts it. This fixture used to be the bare receipt, and passing
    // that off as a reply is the fiction the reply type now refuses.
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

  /**
   * The game's own sentence, on the refusal path as well as the gate path.
   *
   * A refusal carries `detail` all the way here: the mod writes it,
   * `AppendCommandResult` puts it on the wire, the client puts it on the thrown
   * `CommandError`, and `classifyCommandRejection` reads it back.
   * `commandRefusalSentence` prefers it over every sentence written in this
   * package. This component then rebuilt the refusal field by field and left
   * that one out, so the sentence fell through to the general clause for the
   * coarse code and an operator read "the game would not say why" about a
   * refusal that said exactly why.
   *
   * Nothing caught it because the only `detail` in this file was on the BLOCKED
   * path, where the whole gate object is spread rather than copied. It bites
   * hardest on a refusal that carries no `LimitBreach`, which is most of them:
   * `detail` is then the only clause there is.
   */
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
    expect(button.getAttribute("title")).toBe(
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

  /**
   * The defect this exists for: `lost` settled the control to `idle` with a
   * null reason, byte-identical to the confirmed path one line above it, so a
   * command the engine dropped for a downed link looked exactly like one that
   * ran. It affects every control built on this one.
   */
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

    // The press meant something; a control still announcing "Hire ..." has told
    // a screen-reader user nothing happened.
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

describe("CommandButton: a dead command echoes on the control that issued it", () => {
  it("carries data-failed while the handle holds an overdue dispatch", () => {
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
    expect(screen.getByRole("button", { name: "Hire" })).toHaveAttribute(
      "data-failed",
      "true",
    );
  });
});

describe("CommandButton: the blocked phase", () => {
  /** A gate the mod has already decided, in the shape `useCommand.gate` returns. */
  function blockedGate(over: Record<string, unknown> = {}) {
    return {
      blocked: true,
      // CommandErrorCode.SiteOccupied
      errorCode: 17,
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
    // The load-bearing half: `disabled` would drop it from some screen readers'
    // walk entirely, leaving nothing where the reason should be.
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
            errorCode: 8,
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
          gate: { blocked: false, errorCode: 0 },
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
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      d.resolve(OK);
    });
  });

  it("leaves a control the mod could not judge alone, since sandbox nulls one authority", async () => {
    // ScenarioUpgradeableFacilities is a career/mission-only [KSPScenario], so
    // its Instance is null in a sandbox save and every facility gate answers
    // Unknown. Darkening on that would black out a working control in every
    // sandbox game, with a sentence that reads like the game's own.
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <CommandButton
        handle={makeHandle(send, {
          gate: {
            blocked: false,
            undetermined: true,
            command: "career.tech.unlock",
            errorCode: 1,
            detail: "the facilities scenario is not loaded",
          },
        })}
        label="Unlock"
      />,
    );

    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveTextContent("Unlock");
    // Reports itself for a diagnostic surface without saying anything to the
    // operator that it cannot back up.
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
