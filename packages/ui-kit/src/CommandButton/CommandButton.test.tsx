import {
  bindCommand,
  bindValue,
  CommandErrorCode,
  railTagsForCommand,
  type SendStatus,
  type UseCommandResult,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../Button";
import { commandLossSentence } from "../CommandDelay/commandLossSentence";
import {
  createDelayRailStore,
  DelayRailContext,
} from "../CommandDelay/DelayRailContext";
import { PanelDelayRail } from "../CommandDelay/PanelDelayRail";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import { ToggleButton } from "../ToggleButton";
import { emittedStateRuleFor } from "../test/emittedRule";
import {
  ARM_TIMEOUT_MS,
  type CommandButtonHandle,
  type CommandReplyLike,
  REFUSAL_TIMEOUT_MS,
  SENT_FLASH_MS,
  STREAM_DOWN_TIP,
  useCommandControl,
} from "./commandControl";
import type { CommandToggle } from "./toggle";

// The rail axes come from the production derivation, so the fixture follows it rather than asserting a stale literal.
const RAIL_DISCRETE = railTagsForCommand("vessel.control.setSasMode");

/** What a confirmed dispatch resolves with, as the wire answers it: a `CommandResult` envelope. */
const OK: CommandReplyLike = { success: true };

/** A hand-built handle satisfying the structural `CommandButtonHandle`; only the dispatch is a fixture. */
function makeHandle(
  send: CommandButtonHandle["dangerouslySendWithoutInput"],
  over: Partial<CommandButtonHandle> = {},
): CommandButtonHandle {
  const handle: CommandButtonHandle = {
    dangerouslySendWithoutInput: send,
    inFlight: [],
    tags: RAIL_DISCRETE,
    effectiveDelaySeconds: 0,
    with(args, options) {
      return bindCommand(this, args, options);
    },
    toArgs(toArgs, options) {
      return bindValue(this, toArgs, options);
    },
    ...over,
  };
  return handle;
}

/** A toggle built the long way: the hook runs here with a full `toggle` config and the button draws from its control. */
function ConfiguredToggle({
  handle,
  commandLabel,
  toggle,
  icon,
  ...rest
}: {
  handle: CommandButtonHandle;
  commandLabel?: string;
  label?: string;
  toggle: CommandToggle;
  icon?: ReactNode;
  "aria-label"?: string;
}) {
  const control = useCommandControl({
    command: handle.with(undefined, { label: commandLabel }),
    toggle,
  });
  return <ToggleButton command={control} icon={icon} {...rest} />;
}

type Deferred<Reply = CommandReplyLike> = ReturnType<typeof deferred<Reply>>;

/** A dispatch the test settles by hand, which is what a delay window is. */
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
      <Button command={makeHandle(send).with({ id: "x" })} variant="ghost">
        Go
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ id: "x" }, undefined);
    await act(async () => {});
  });

  it("settles a dispatch under StrictMode's mount, unmount, mount", async () => {
    const user = useArmClock();
    const reply = deferred();
    render(
      <StrictMode>
        <Button command={makeHandle(() => reply.promise)} variant="ghost">
          Go
        </Button>
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "sent",
    );
    await act(async () => reply.resolve(OK));
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });

    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });

  it("disarms when its args change under it, so the confirm never sends to another item", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const handle = makeHandle(send);
    const { rerender } = render(
      <Button
        command={handle.with({ id: "a" })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Fire
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "armed",
    );

    rerender(
      <Button
        command={handle.with({ id: "b" })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Fire
      </Button>,
    );

    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("disarms when a game load starts a new timeline, so a confirm cannot fire at the world it replaced", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const handle = makeHandle(send);
    const stream = setupStreamFixture();
    render(
      <stream.Provider>
        <Button
          command={handle.with({ id: "a" })}
          variant="ghost"
          confirmLabel="Confirm"
        >
          Fire
        </Button>
      </stream.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Fire" }));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "armed",
    );

    act(() =>
      stream.transport.emitRaw({
        type: "game-state",
        state: "ready",
        scene: "FLIGHT",
        bootId: "run-a",
        timelineEpoch: 1,
      }),
    );

    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("stays armed across a re-render that hands it equal args", async () => {
    const user = userEvent.setup();
    const handle = makeHandle(() => Promise.resolve(OK));
    const { rerender } = render(
      <Button
        command={handle.with({ id: "a" })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Fire
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Fire" }));
    rerender(
      <Button
        command={handle.with({ id: "a" })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Fire
      </Button>,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "armed",
    );
  });

  it("passes commandLabel through as the dispatch label, so a refusal can name it", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send).with(undefined, {
          label: "Hire Valentina Kerman",
        })}
        variant="ghost"
      >
        Hire
      </Button>,
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
      <Button command={makeHandle(send)} variant="ghost" confirmLabel="Confirm">
        Fire
      </Button>,
    );
    const resting = screen.getByRole("button", { name: "Fire" });
    expect(resting.dataset.restLabel).toBe("Fire");
    // The widest word the button can show, the outcome words included, so no phase resizes it.
    expect(resting.dataset.armedLabel).toBe("No reply");

    await user.click(resting);

    const armed = screen.getByRole("button", { name: "Confirm" });
    expect(armed.dataset.restLabel).toBe("Fire");
    expect(armed.dataset.armedLabel).toBe("No reply");
  });

  it("arms on the first click and dispatches nothing", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button command={makeHandle(send)} variant="ghost" confirmLabel="Confirm">
        Fire
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Fire" }));

    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches on the second click", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send).with("kerbal")}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Fire
      </Button>,
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
      <Button command={makeHandle(send)} variant="ghost" confirmLabel="Confirm">
        Fire
      </Button>,
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

/** A handle's status for a dispatch the mod has or has not yet answered. */
function inFlightStatus(accepted: boolean): CommandButtonHandle["status"] {
  return accepted
    ? { phase: "in-flight", requestId: "r1", etaConfirm: 60, accepted: true }
    : { phase: "in-flight", requestId: "r1", etaConfirm: 60 };
}

describe("CommandButton: the sent window", () => {
  it("reads SENT for the flash, then is live again while the reply is outstanding", async () => {
    const user = useArmClock();
    const d = deferred();
    render(
      <Button
        command={makeHandle(() => d.promise, { status: inFlightStatus(true) })}
        variant="ghost"
      >
        Go
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));

    const sent = screen.getByRole("button");
    expect(sent).toHaveAttribute("data-command-phase", "sent");
    expect(sent).toHaveTextContent("SENT");
    expect(sent).not.toHaveAttribute("aria-busy");

    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });
    const live = screen.getByRole("button", { name: "Go" });
    expect(live).toHaveAttribute("data-command-phase", "idle");
    expect(live).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      d.resolve(OK);
    });
  });

  it("keeps reading SENT while the mod has not answered the press", async () => {
    const user = useArmClock();
    const d = deferred();
    const draw = (accepted: boolean) => (
      <Button
        command={makeHandle(() => d.promise, {
          status: inFlightStatus(accepted),
        })}
        variant="ghost"
      >
        Go
      </Button>
    );
    const { rerender } = render(draw(false));

    await user.click(screen.getByRole("button", { name: "Go" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "sent",
    );

    rerender(draw(true));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
    await act(async () => {
      d.resolve(OK);
    });
  });

  it("sends again on a second press while the first is outstanding", async () => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    render(
      <Button
        command={makeHandle(send, { status: inFlightStatus(true) })}
        variant="ghost"
      >
        Go
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));
    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("holds the width of its resting word, so SENT never reflows the row", () => {
    render(
      <Button command={makeHandle(() => Promise.resolve(OK))} variant="ghost">
        Launch vessel
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-rest-label", "Launch vessel");
    expect(button).toHaveAttribute("data-armed-label", "No reply");
  });

  it("says in words that the press has gone and not been received", async () => {
    const user = useArmClock();
    render(
      <Button
        command={makeHandle(() => deferred().promise).with(undefined, {
          label: "Launch vessel",
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Launch" }));

    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Launch vessel sent, not yet received",
    );
  });

  it("calls onConfirmed once the dispatch is confirmed, and not before", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onConfirmed = vi.fn();
    render(
      <Button
        command={makeHandle(() => d.promise).with(undefined, {
          onConfirmed: onConfirmed,
        })}
        variant="ghost"
      >
        Go
      </Button>,
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
      <Button
        command={makeHandle(() => d.promise).with(undefined, {
          onConfirmed: onConfirmed,
        })}
        variant="ghost"
      >
        Go
      </Button>,
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
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
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
      <Button
        command={makeHandle(() => d.promise).with(undefined, {
          label: "Upgrade Launch Pad",
        })}
        variant="ghost"
      >
        Upgrade
      </Button>,
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

  describe.each([
    { rail: true, region: "stays quiet beside a mounted rail" },
    { rail: false, region: "still says it with no rail drawn" },
  ])("a lost command, $region", ({ rail }) => {
    it("announces from the control only when no rail will", async () => {
      const user = userEvent.setup();
      const d = deferred();
      const store = createDelayRailStore();
      const { container } = render(
        <DelayRailContext.Provider value={store}>
          {rail && <PanelDelayRail />}
          <Button
            command={makeHandle(() => d.promise, { railed: true })}
            variant="ghost"
          >
            Go
          </Button>
        </DelayRailContext.Provider>,
      );
      await user.click(screen.getByRole("button", { name: "Go" }));
      await act(async () => {
        d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
      });
      if (rail) expect(announcer(container)).toBeEmptyDOMElement();
      else expect(announcer(container)).not.toBeEmptyDOMElement();
    });
  });

  it("announces from the control when its handle is not on the rail beside it", async () => {
    // A handle the rail does not hold is one the rail will never speak for, so the control must.
    const user = userEvent.setup();
    const d = deferred();
    const store = createDelayRailStore();
    const { container } = render(
      <DelayRailContext.Provider value={store}>
        <PanelDelayRail />
        <Button
          command={makeHandle(() => d.promise, { railed: false })}
          variant="ghost"
        >
          Go
        </Button>
      </DelayRailContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(announcer(container)).toHaveTextContent(/no reply/i);
  });

  it("says a loss", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const { container } = render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    expect(announcer(container)).toHaveTextContent(/no reply/i);
  });

  it("says nothing at rest", () => {
    const { container } = render(
      <Button command={makeHandle(() => deferred().promise)} variant="ghost">
        Go
      </Button>,
    );
    expect(announcer(container)).toBeEmptyDOMElement();
  });
});

describe("CommandButton: the refused phase", () => {
  it("says the game refused, and why, without the caller deriving it", async () => {
    const user = userEvent.setup();
    const d = deferred();
    render(
      <Button
        command={makeHandle(() => d.promise).with(undefined, {
          label: "Upgrade Launch Pad",
        })}
        variant="ghost"
      >
        Upgrade
      </Button>,
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
      <Button
        command={makeHandle(() => d.promise).with(undefined, {
          label: "Arm the write surface",
        })}
        variant="ghost"
      >
        ARM WRITES
      </Button>,
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
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Upgrade
      </Button>,
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
    render(
      <Button command={makeHandle(send)} variant="ghost">
        Upgrade
      </Button>,
    );

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
    render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
    );

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
      // biome-ignore lint/correctness/useHookAtTopLevel: a test helper named like a hook, not a React hook
      const user = useArmClock();
      const d = deferred();
      const { unmount } = render(
        <Button command={makeHandle(() => d.promise)} variant="ghost">
          Go
        </Button>,
      );
      await user.click(screen.getByRole("button", { name: "Go" }));
      await act(async () => {
        settle(d);
      });
      act(() => {
        vi.advanceTimersByTime(SENT_FLASH_MS + 1);
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
    render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
    );

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
    const user = useArmClock();
    const d = deferred();
    render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => {
      d.reject(new Error("socket died"));
    });
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
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
      <Button
        command={makeHandle(() => Promise.resolve(OK))}
        variant="ghost"
        confirmLabel="Confirm"
        aria-label="Hire Desdin Kerman for 30,000 funds"
      >
        Hire
      </Button>,
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
      <Button
        command={makeHandle(() => Promise.resolve(OK))}
        variant="ghost"
        confirmLabel="Confirm"
        aria-label="Hire Desdin Kerman"
        confirmAriaLabel="Confirm hire of Desdin Kerman"
      >
        Hire
      </Button>,
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
      <Button
        command={makeHandle(() => d.promise)}
        variant="ghost"
        aria-label="Upgrade Launch Pad"
      >
        Upgrade
      </Button>,
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
      <Button
        command={makeHandle(() => Promise.resolve(OK))}
        variant="ghost"
        pressed
      >
        SAS
      </Button>,
    );
    expect(screen.getByRole("button", { name: "SAS" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("carries no aria-pressed when it only acts", () => {
    render(
      <Button command={makeHandle(() => Promise.resolve(OK))} variant="ghost">
        Hire
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Hire" })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("arms and reads SENT exactly the same when it is a toggle", async () => {
    const user = useArmClock();
    const d = deferred();
    render(
      <Button
        command={makeHandle(() => d.promise)}
        variant="ghost"
        confirmLabel="Confirm SAS"
        pressed={false}
      >
        SAS
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "SAS" }));
    await user.click(screen.getByRole("button", { name: "Confirm SAS" }));

    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "sent",
    );
    await act(async () => {
      d.resolve(OK);
    });
  });

  it("carries data-unconfirmed, never data-failed, while the handle holds an overdue dispatch", () => {
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          inFlight: [
            {
              id: "r1",
              command: "career.crew.hire",
              predictedPhase: "overdue",
            } as never,
          ],
        })}
        variant="ghost"
      >
        Hire
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Hire" });
    expect(button).toHaveAttribute("data-unconfirmed", "true");
    expect(button).not.toHaveAttribute("data-failed");
  });

  it("carries data-failed while the handle holds a dispatch that never left", () => {
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          undelivered: [{ id: "u1", command: "career.crew.hire", label: "" }],
        })}
        variant="ghost"
      >
        Hire
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Hire" });
    expect(button).toHaveAttribute("data-failed", "true");
    expect(button).not.toHaveAttribute("data-unconfirmed");
  });
});

describe("CommandButton: the blocked phase, for an instant command", () => {
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
      <Button
        command={makeHandle(send, {
          gateStopsPress: true,
          gate: blockedGate(),
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button"));

    expect(send).not.toHaveBeenCalled();
  });

  it("draws from the verdict for the item its own args name", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const handle = makeHandle(send, {
      gateStopsPress: true,
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
        <Button
          command={handle.with({ facilityId: "LaunchPad" })}
          variant="ghost"
        >
          Upgrade pad
        </Button>
        <Button command={handle.with({ facilityId: "Runway" })} variant="ghost">
          Upgrade runway
        </Button>
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
      <Button command={makeHandle(() => Promise.resolve(OK))} variant="ghost">
        Launch
      </Button>,
    );
    const ungated = screen.getByRole("button");
    expect(ungated).not.toHaveAttribute("aria-disabled");
    expect(ungated).not.toBeDisabled();

    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gateStopsPress: true,
          gate: blockedGate(),
        }).with(undefined, { label: "Launch Kerbal I" })}
        variant="ghost"
      >
        Launch
      </Button>,
    );
    const gated = screen.getAllByRole("button")[1];
    expect(gated).toHaveAttribute("aria-disabled", "true");
    // `disabled` would drop it from some screen readers' walk, leaving nothing where the reason should be.
    expect(gated).not.toBeDisabled();
  });

  it("keeps the control's own name and gives the reason as its description", () => {
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gateStopsPress: true,
          gate: blockedGate(),
        }).with(undefined, { label: "Launch Kerbal I" })}
        variant="ghost"
        aria-label="Launch Kerbal I"
      >
        Launch
      </Button>,
    );

    // The name says which control it is; the game's own words, through the shared composer, are read after it.
    const button = screen.getByRole("button", { name: "Launch Kerbal I" });
    expect(button).toHaveAccessibleDescription(
      "Launch Kerbal I unavailable: Launch Pad is occupied.",
    );
  });

  it("quotes the numbers when the gate carried a breach", () => {
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gateStopsPress: true,
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
        }).with(undefined, { label: "Hire Valentina Kerman" })}
        variant="ghost"
      >
        Hire
      </Button>,
    );

    expect(
      screen.getByRole("button", { name: "Hire" }),
    ).toHaveAccessibleDescription(
      "Hire Valentina Kerman unavailable: the Astronaut Complex holds 16 of 16 active crew.",
    );
  });

  it("never prints the reason in the control: a press sends nothing and the reason stays in the tip and the description", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send, {
          gateStopsPress: true,
          gate: blockedGate(),
        }).with(undefined, {
          label: "Launch Kerbal I",
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Launch");
    expect(button).toHaveAttribute("aria-disabled", "true");

    await user.click(button);

    expect(send).not.toHaveBeenCalled();
    expect(button).toHaveTextContent("Launch");
    expect(button).toHaveAccessibleName("Launch");
    expect(button).toHaveAccessibleDescription(
      "Launch Kerbal I unavailable: Launch Pad is occupied.",
    );
  });

  it("comes back to life the moment the gate opens", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    const { rerender } = render(
      <Button
        command={makeHandle(send, {
          gateStopsPress: true,
          gate: blockedGate(),
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    rerender(
      <Button
        command={makeHandle(send, {
          gate: { blocked: false, errorCode: CommandErrorCode.ModeUnavailable },
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    expect(send).toHaveBeenCalledOnce();
  });

  it("leaves an ungated handle exactly as it was, so nothing changes for a command with no gates", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button command={makeHandle(send)} variant="ghost">
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("lets a sent command show rather than reading as blocked behind it", async () => {
    const user = useArmClock();
    const d = deferred();
    const { rerender } = render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "sent",
    );

    // The gate shuts behind the command that is already sent.
    rerender(
      <Button
        command={makeHandle(() => d.promise, {
          gateStopsPress: true,
          gate: blockedGate(),
        })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "sent",
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
      <Button
        command={makeHandle(send, {
          gate: {
            blocked: false,
            undetermined: true,
            command: "career.tech.unlock",
            errorCode: CommandErrorCode.ModeUnavailable,
            detail: "the facilities scenario is not loaded",
          },
        })}
        variant="ghost"
      >
        Unlock
      </Button>,
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
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gateStopsPress: true,
          gate: blockedGate(),
        }).with(undefined, { label: "Launch Kerbal I" })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    await expectNoA11yViolations(container);
  });
});

describe("CommandButton: the advised phase, for a delayed command", () => {
  const advisedGate = {
    blocked: true,
    errorCode: CommandErrorCode.SiteOccupied,
    detail: "Launch Pad is occupied",
  };

  it("sends the press anyway, for the game to decide on arrival", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send, { gate: advisedGate, gateStopsPress: false })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("stays live and says the command is likely to be refused, in its tip and on its edge", () => {
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gate: advisedGate,
          gateStopsPress: false,
        }).with(undefined, { label: "Launch Kerbal I" })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveAttribute("data-gate", "advised");
    expect(button).toHaveAttribute("data-predicted", "at-risk");
    expect(button).toHaveAccessibleDescription(
      "Launch Kerbal I likely to be refused: Launch Pad is occupied.",
    );
  });

  it("treats a handle that does not say it is instant as delayed", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button command={makeHandle(send, { gate: advisedGate })} variant="ghost">
        Launch
      </Button>,
    );

    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledOnce();
  });

  it("advises from the caller's own reason and still sends", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send)}
        advise="the craft reports no SAS"
        variant="ghost"
      >
        SAS
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-predicted", "at-risk");
    expect(button).toHaveAccessibleDescription(
      "Likely to be refused: the craft reports no SAS.",
    );
    await user.click(button);
    expect(send).toHaveBeenCalledOnce();
  });

  it("stops the press with the caller's reason in the control's own words when the command goes through within a few seconds", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <Button
        command={makeHandle(send, { gateStopsPress: true }).with(undefined, {
          label: "Toggle SAS",
        })}
        advise="the craft reports no SAS"
        variant="ghost"
      >
        SAS
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(
      "Toggle SAS unavailable: the craft reports no SAS.",
    );
    await user.click(button);
    expect(send).not.toHaveBeenCalled();
  });

  it("has no axe violations while advised", async () => {
    const { container } = render(
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gate: advisedGate,
          gateStopsPress: false,
        }).with(undefined, { label: "Launch Kerbal I" })}
        variant="ghost"
      >
        Launch
      </Button>,
    );

    await expectNoA11yViolations(container);
  });
});

describe("CommandButton: accessibility", () => {
  let container: HTMLElement;

  beforeEach(() => {
    ({ container } = render(
      <Button
        command={makeHandle(() => Promise.resolve(OK))}
        variant="ghost"
        confirmLabel="Confirm hire"
        pressed={false}
      >
        Hire
      </Button>,
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
      <Button command={makeHandle(send)} variant="ghost">
        SAS
      </Button>,
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
        <Button command={makeHandle(send, { founds })} variant="ghost">
          SAS
        </Button>,
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
      <Button command={makeHandle(send)} variant="ghost">
        SAS
      </Button>,
    );
    await act(async () => {
      rerender(
        <Button command={makeHandle(send, { founds: RAN })} variant="ghost">
          SAS
        </Button>,
      );
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });

  it("does not claim a later found once the operator has cleared the loss", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const { rerender } = render(
      <Button command={makeHandle(send)} variant="ghost">
        SAS
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "SAS" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    // Clears the loss; the control is back at rest.
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
    // Another row's lost command is found on the shared handle.
    await act(async () => {
      rerender(
        <Button command={makeHandle(send, { founds: RAN })} variant="ghost">
          SAS
        </Button>,
      );
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });

  it("ignores a found whose label names a different command", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const { rerender } = render(
      <Button
        command={makeHandle(send).with(undefined, {
          label: "Hire Valentina Kerman",
        })}
        variant="ghost"
      >
        Hire
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Hire" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    await act(async () => {
      rerender(
        <Button
          command={makeHandle(send, {
            founds: [
              {
                id: "c9",
                command: "career.crew.hire",
                label: "Hire Bill Kerman",
                outcome: "ran",
              },
            ],
          }).with(undefined, { label: "Hire Valentina Kerman" })}
          variant="ghost"
        >
          Hire
        </Button>,
      );
    });
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-command-phase",
      "lost",
    );
  });

  it("shows a found on every control that sent the same command, which nothing tells apart", async () => {
    // Two rows sharing a handle that dispatch with no args and no label are one command to the wire, so a found for it is each row's.
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const pair = (handle: CommandButtonHandle) => (
      <>
        <Button command={handle} variant="ghost">
          First
        </Button>
        <Button command={handle} variant="ghost">
          Second
        </Button>
      </>
    );
    const { rerender } = render(pair(makeHandle(send)));
    await user.click(screen.getByRole("button", { name: "First" }));
    await user.click(screen.getByRole("button", { name: "Second" }));
    await act(async () => {
      d.reject(Object.assign(new Error("lost"), { code: "E_LOST" }));
    });
    await act(async () => {
      rerender(
        pair(
          makeHandle(send, {
            founds: [{ id: "c1", command: "x", label: "", outcome: "ran" }],
          }),
        ),
      );
    });
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("data-command-phase", "found");
    }
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
      <Button
        command={makeHandle(() => Promise.resolve(OK), {
          gateStopsPress: true,
          gate: {
            blocked: true,
            errorCode: CommandErrorCode.NoConnection,
            detail: "Launch Pad is occupied",
          },
        })}
        variant="ghost"
      >
        Launch
      </Button>,
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
  it("stays focused while sent, so the outcome lands on the control the operator is on", async () => {
    const user = useArmClock();
    const d = deferred();
    render(
      <Button command={makeHandle(() => d.promise)} variant="ghost">
        Go
      </Button>,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    const sent = screen.getByRole("button");
    expect(sent).toHaveAttribute("data-command-phase", "sent");
    expect(sent).not.toBeDisabled();
    expect(sent).toHaveFocus();
    await act(async () => {
      d.resolve(OK);
    });
  });
});

describe("useCommandControl's loss sentence", () => {
  function Custom({ handle }: { handle: CommandButtonHandle }) {
    const state = useCommandControl({
      command: bindCommand(handle, undefined, {
        label: "Stage",
      }),
    });
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

type PressReady = (press: (() => void) | null) => void;

describe("CommandButton onPressReady", () => {
  it("keeps a press listed after a dispatch, since a second press is always sent", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const send = vi.fn(() => d.promise);
    const onPressReady = vi.fn<PressReady>();
    render(
      <Button
        command={makeHandle(send)}
        variant="ghost"
        onPressReady={onPressReady}
      >
        Stage
      </Button>,
    );
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeTypeOf("function");

    await user.click(screen.getByRole("button", { name: "Stage" }));
    expect(send).toHaveBeenCalledOnce();
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeTypeOf("function");

    await act(async () => {
      d.resolve(OK);
    });
    await act(async () => {
      d.resolve(OK);
    });
    expect(onPressReady.mock.calls.at(-1)?.[0]).toBeTypeOf("function");
  });

  it("presses the control from the listed press, arming before it dispatches", async () => {
    const send = vi.fn(() => Promise.resolve(OK));
    const onPressReady = vi.fn<PressReady>();
    render(
      <Button
        command={makeHandle(send)}
        variant="ghost"
        confirmLabel="Confirm recover"
        onPressReady={onPressReady}
      >
        Recover
      </Button>,
    );
    const listed = () => {
      const press = onPressReady.mock.calls.at(-1)?.[0];
      if (!press) throw new Error("no press listed");
      return press;
    };
    act(() => listed()());
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("Confirm recover");
    act(() => listed()());
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it("dispatches at once from the listed press of a control with no confirm step", async () => {
    const send = vi.fn(() => Promise.resolve(OK));
    const onPressReady = vi.fn<PressReady>();
    render(
      <Button
        command={makeHandle(send)}
        variant="ghost"
        onPressReady={onPressReady}
      >
        Stage
      </Button>,
    );
    act(() => onPressReady.mock.calls.at(-1)?.[0]?.());
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {});
  });
});

describe("CommandButton icon", () => {
  it("names the control by its word and keeps the word as the name when armed", async () => {
    const user = userEvent.setup();
    render(
      <Button
        command={makeHandle(() => Promise.resolve(OK))}
        variant="ghost"
        confirmLabel="Confirm"
        icon={<svg data-testid="up" />}
        confirmIcon={<svg data-testid="check" />}
      >
        Upgrade
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();
    await act(async () => {});
  });
});

describe("CommandButton send status", () => {
  const status = (over: Partial<SendStatus>): SendStatus => ({
    contact: { kind: "in-contact" },
    signalDelay: value("s", 480),
    arrival: "expected",
    sends: "now",
    ...over,
  });
  const held = status({
    contact: { kind: "back-in", seconds: value("s", 180) },
    sends: "held",
    heldUntilUt: value("ut", 1180),
    arrivesUt: value("ut", 1660),
  });
  const loss = status({
    contact: { kind: "loss-in", seconds: value("s", 300) },
    arrival: "likely-lost",
  });
  const none: SendStatus = {
    contact: { kind: "none" },
    arrival: "likely-lost",
  };

  it.each([
    ["an order that goes at once", status({}), undefined],
    ["a held order", held, "held"],
    ["an order expected to be lost", loss, "at-risk"],
    ["an order with no route", none, "at-risk"],
  ] as const)("outlines %s as %s and still sends on a press", async (_name, sendStatus, predicted) => {
    const send = vi.fn().mockResolvedValue(OK);
    const { container } = render(
      <Button command={makeHandle(send, { sendStatus })} variant="ghost">
        Fire
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Fire" });
    expect(button.getAttribute("data-predicted")).toBe(predicted ?? null);
    await userEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it("draws nothing beside the control, in any state", () => {
    const { container } = render(
      <Button
        command={makeHandle(vi.fn(), { sendStatus: held })}
        variant="ghost"
      >
        Fire
      </Button>,
    );
    expect(screen.queryByText(/No contact/)).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("writes the status in the tooltip", async () => {
    render(
      <Button
        command={makeHandle(vi.fn(), { sendStatus: loss })}
        variant="ghost"
      >
        Fire
      </Button>,
    );
    await userEvent.hover(screen.getByRole("button", { name: "Fire" }));
    expect(
      await screen.findByText(/LOS in 5min · 8min signal delay/),
    ).toBeTruthy();
  });

  it("keeps the predicted outline to the edge's style and colour, so no state moves the box", () => {
    render(
      <Button
        command={makeHandle(vi.fn(), { sendStatus: held })}
        variant="ghost"
      >
        Fire
      </Button>,
    );
    const rules = [...document.querySelectorAll("style")]
      .flatMap((sheet) => [...(sheet.sheet?.cssRules ?? [])])
      .filter((rule) => rule.cssText.includes("data-predicted"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const property of (rule as CSSStyleRule).style) {
        expect(property).toMatch(
          /^border(-top|-right|-bottom|-left)*-(style|color)$|^border-(style|color)$/,
        );
      }
    }
  });
});

describe("CommandButton: the stream to the mod is down", () => {
  it("greys out, says why, and sends nothing on a press, then sends again once the stream returns", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => OK);
    const down = makeHandle(send, { streamDown: true });
    const { rerender } = render(
      <Button command={down} variant="ghost" tip="Fire it">
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("data-stream", "down");
    // Not the dashed look a gate refusal wears.
    expect(button).not.toHaveAttribute("data-gate");

    await user.click(button);
    await user.click(button);
    expect(send).not.toHaveBeenCalled();

    rerender(
      <Button
        command={makeHandle(send, { streamDown: false })}
        variant="ghost"
        tip="Fire it"
      >
        Go
      </Button>,
    );
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("data-stream");
    await user.click(button);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not arm an arm-then-confirm control while the stream is down", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => OK);
    render(
      <Button
        command={makeHandle(send, { streamDown: true })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Go
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.queryByText("Confirm")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the size of the same button with the stream up", () => {
    const send = vi.fn(async () => OK);
    const { container, rerender } = render(
      <Button
        command={makeHandle(send, { streamDown: true })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Go
      </Button>,
    );
    const down = container.querySelector("button")?.outerHTML ?? "";
    rerender(
      <Button
        command={makeHandle(send, { streamDown: false })}
        variant="ghost"
        confirmLabel="Confirm"
      >
        Go
      </Button>,
    );
    const up = container.querySelector("button")?.outerHTML ?? "";
    const strip = (html: string) =>
      html.replace(
        /\s(aria-disabled|data-stream|data-tooltip|aria-description)="[^"]*"/g,
        "",
      );
    expect(down).toContain(STREAM_DOWN_TIP);
    expect(strip(down)).toBe(strip(up));
  });
});

describe("CommandButton: the toggle variant", () => {
  const WORDS = ["RCS ON", "RCS OFF", "RCS UNREAD"];
  const word = (shown: boolean | number | null | undefined) =>
    shown === true ? "RCS ON" : shown === false ? "RCS OFF" : "RCS UNREAD";

  /** A toggle on a handle whose rows and status the test sets. */
  function draw(
    state: boolean | null,
    send: CommandButtonHandle["dangerouslySendWithoutInput"],
    over: Partial<CommandButtonHandle> = {},
  ) {
    return (
      <ConfiguredToggle
        handle={makeHandle(send, over)}
        commandLabel="Toggle RCS"
        label="RCS"
        toggle={{
          state,
          name: "RCS",
          word,
          words: WORDS,
          sentWord: "RCS SENT",
          args: (base) =>
            typeof base === "boolean" ? { enabled: !base } : undefined,
        }}
      />
    );
  }

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: "r1",
      label: "Toggle RCS",
      command: "vessel.control.setRcs",
      predictedPhase: "in-transit",
      ...over,
    }) as never;

  it("sends the opposite of the state it shows and reads SENT until the mod answers", async () => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    render(draw(false, send, { status: inFlightStatus(false) }));

    await user.click(screen.getByRole("button", { name: /RCS OFF/ }));

    expect(send).toHaveBeenCalledWith(
      { enabled: true },
      { label: "Toggle RCS" },
    );
    expect(screen.getByRole("button")).toHaveTextContent("RCS SENT");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the state again once the mod answers, and sends again on a second press", async () => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    const { rerender } = render(
      draw(false, send, { status: inFlightStatus(false) }),
    );

    await user.click(screen.getByRole("button"));
    rerender(draw(false, send, { status: inFlightStatus(true) }));
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });
    expect(screen.getByRole("button")).toHaveTextContent("RCS OFF");

    // The first press is outstanding and asked for ON, so a second asks for OFF.
    await user.click(screen.getByRole("button"));
    expect(send).toHaveBeenLastCalledWith(
      { enabled: false },
      { label: "Toggle RCS" },
    );
  });

  it("shows the state a command is predicted to set while its reply is on the way, marked modelled", () => {
    render(
      draw(false, () => Promise.resolve(OK), {
        inFlight: [
          row({ predictedPhase: "awaiting-reply", args: { enabled: true } }),
        ],
      }),
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("RCS ON");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("data-held-button");
  });

  it("marks a command waiting at a relay as held and keeps the state", () => {
    render(
      draw(false, () => Promise.resolve(OK), {
        inFlight: [row({ held: true })],
      }),
    );

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("RCS OFF");
    expect(button).toHaveAttribute("data-held-button");
  });

  it("is drawn dark with its reason and sends nothing while it is unavailable", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(
      <ConfiguredToggle
        handle={makeHandle(send)}
        label="RCS"
        toggle={{
          state: false,
          name: "RCS",
          word,
          words: WORDS,
          unavailable: "The vessel is not controllable",
          args: (base) =>
            typeof base === "boolean" ? { enabled: !base } : undefined,
        }}
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing from an unread state", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    render(draw(null, send));

    await user.click(screen.getByRole("button"));

    expect(send).not.toHaveBeenCalled();
  });
});

describe("CommandButton: a press while SENT", () => {
  it("neither arms nor sends again on an arm-then-confirm control, so a triple click spends once", async () => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    render(
      <Button
        command={makeHandle(send, { status: inFlightStatus(false) })}
        variant="ghost"
        confirmLabel="Confirm upgrade"
      >
        Upgrade
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    await user.click(screen.getByRole("button", { name: "Confirm upgrade" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("SENT");

    await user.click(screen.getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });
    await user.click(screen.getByRole("button"));

    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("SENT");
    expect(screen.queryByText("Confirm upgrade")).toBeNull();
  });
});

describe("CommandButton: a toggle press that was lost", () => {
  const word = (shown: boolean | number | null | undefined) =>
    shown === true ? "SAS ON" : "SAS OFF";
  const draw = (
    over: Partial<CommandButtonHandle>,
    send: CommandButtonHandle["dangerouslySendWithoutInput"],
  ) => (
    <ConfiguredToggle
      handle={makeHandle(send, over)}
      commandLabel="Toggle SAS"
      label="SAS"
      toggle={{
        state: false,
        name: "SAS",
        word,
        words: ["SAS ON", "SAS OFF"],
        args: (base) =>
          typeof base === "boolean" ? { enabled: !base } : undefined,
      }}
    />
  );

  it.each([
    ["lost", { phase: "lost", requestId: "r1", reason: "no reply" }],
    [
      "failed",
      { phase: "failed", requestId: "r1", error: { code: "E", message: "x" } },
    ],
    ["undelivered", { phase: "undelivered", requestId: "r1", reason: "down" }],
  ] as const)("asks for the opposite of the state shown again after a %s ask", async (_name, status) => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    const { rerender } = render(draw({ status: inFlightStatus(false) }, send));

    await user.click(screen.getByRole("button"));
    expect(send).toHaveBeenLastCalledWith(
      { enabled: true },
      { label: "Toggle SAS" },
    );

    rerender(
      draw(
        {
          status: status as never,
          inFlight: [
            {
              id: "r1",
              label: "Toggle SAS",
              command: "vessel.control.setSas",
              predictedPhase: "lost",
            },
          ] as never,
        },
        send,
      ),
    );
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });
    expect(screen.getByRole("button")).toHaveTextContent("SAS OFF");

    await user.click(screen.getByRole("button"));
    expect(send).toHaveBeenLastCalledWith(
      { enabled: true },
      { label: "Toggle SAS" },
    );
  });
});

describe("CommandButton: SENT belongs to the button's own dispatch", () => {
  it("does not return to SENT when another button on the same handle is pressed", async () => {
    const user = useArmClock();
    const send = vi.fn(() => deferred().promise);
    const draw = (status: CommandButtonHandle["status"]) => {
      const handle = makeHandle(send, { status });
      return (
        <>
          <Button command={handle.with("a")} variant="ghost">
            Row A
          </Button>
          <Button command={handle.with("b")} variant="ghost">
            Row B
          </Button>
        </>
      );
    };
    const { rerender } = render(draw({ phase: "idle" }));

    await user.click(screen.getByRole("button", { name: "Row A" }));
    rerender(draw(inFlightStatus(false)));
    rerender(
      draw({
        phase: "in-flight",
        requestId: "r1",
        etaConfirm: 60,
        accepted: true,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });
    expect(screen.getByRole("button", { name: "Row A" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Row B" }));
    rerender(draw({ phase: "in-flight", requestId: "r2", etaConfirm: 60 }));
    act(() => {
      vi.advanceTimersByTime(SENT_FLASH_MS + 1);
    });

    expect(screen.getByRole("button", { name: "Row A" })).toHaveAttribute(
      "data-command-phase",
      "idle",
    );
  });
});
