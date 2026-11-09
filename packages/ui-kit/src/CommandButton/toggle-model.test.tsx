import {
  bindCommand,
  bindValue,
  railTagsForCommand,
  type UseCommandResult,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToggleButton } from "../ToggleButton";
import {
  type CommandButtonHandle,
  type CommandReplyLike,
  useCommandControl,
} from "./commandControl";
import type { CommandToggle } from "./toggle";

const OK: CommandReplyLike = { success: true };

function handle(
  send: CommandButtonHandle["dangerouslySendWithoutInput"],
  over: Partial<CommandButtonHandle> = {},
): CommandButtonHandle {
  const self: CommandButtonHandle = {
    dangerouslySendWithoutInput: send,
    inFlight: [],
    tags: railTagsForCommand("vessel.control.setRcs"),
    effectiveDelaySeconds: 8,
    with(args, options) {
      return bindCommand(this, args, options);
    },
    toArgs(toArgs, options) {
      return bindValue(this, toArgs, options);
    },
    ...over,
  };
  return self;
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

const row = (id: string, args: unknown, over: Record<string, unknown> = {}) =>
  ({
    id,
    label: "Toggle RCS",
    command: "vessel.control.setRcs",
    predictedPhase: "awaiting-reply",
    dispatchedAt: 0,
    oneWaySeconds: 8,
    args,
    ...over,
  }) as never;

const word = (shown: boolean | number | null | undefined) =>
  typeof shown === "number"
    ? `STAGE ${shown}`
    : shown === true
      ? "RCS ON"
      : shown === false
        ? "RCS OFF"
        : "RCS UNREAD";

function toggleButton(
  state: boolean | number | null,
  h: CommandButtonHandle,
  args: (base: unknown) => unknown = (base) =>
    typeof base === "boolean" ? { enabled: !base } : undefined,
  modelled?: (state: unknown, args: unknown) => unknown,
) {
  return (
    <ConfiguredToggle
      handle={h}
      commandLabel="Toggle RCS"
      label="RCS"
      toggle={{
        state,
        name: "RCS",
        word,
        words: ["RCS ON", "RCS OFF", "RCS UNREAD", "STAGE 3", "STAGE 2"],
        args: args as never,
        modelled: modelled as never,
      }}
    />
  );
}

describe("a toggle's modelled state follows the values its commands carry", () => {
  it("shows ON after two arrived commands that both set ON, not the held OFF", () => {
    render(
      toggleButton(
        false,
        handle(() => Promise.resolve(OK), {
          inFlight: [
            row("a", { enabled: true }),
            row("b", { enabled: true }, { dispatchedAt: 1 }),
          ],
        }),
      ),
    );

    expect(screen.getByRole("button")).toHaveTextContent("RCS ON");
  });

  it("lets the last arrival win when an ON is followed by an OFF", () => {
    render(
      toggleButton(
        true,
        handle(() => Promise.resolve(OK), {
          inFlight: [
            row("a", { enabled: true }),
            row("b", { enabled: false }, { dispatchedAt: 1 }),
          ],
        }),
      ),
    );

    expect(screen.getByRole("button")).toHaveTextContent("RCS OFF");
  });

  it("orders by arrival, not by the order the rows are listed", () => {
    render(
      toggleButton(
        false,
        handle(() => Promise.resolve(OK), {
          inFlight: [
            row("late", { enabled: false }, { dispatchedAt: 5 }),
            row("early", { enabled: true }, { dispatchedAt: 1 }),
          ],
        }),
      ),
    );

    expect(screen.getByRole("button")).toHaveTextContent("RCS OFF");
  });

  it("steps a numeric state down for an arrived stage command", () => {
    render(
      toggleButton(
        3,
        handle(() => Promise.resolve(OK), {
          inFlight: [row("a", null)],
        }),
        () => null,
        (state) => (typeof state === "number" ? state - 1 : state),
      ),
    );

    expect(screen.getByRole("button")).toHaveTextContent("STAGE 2");
  });
});

describe("a toggle pressed twice before it re-renders", () => {
  it("sends the opposite on the second press", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => new Promise<CommandReplyLike>(() => {}));
    render(toggleButton(false, handle(send)));
    const button = screen.getByRole("button");

    await act(async () => {
      button.click();
      button.click();
    });
    await user.tab();

    expect(send.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { enabled: true },
      { enabled: false },
    ]);
  });
});

describe("a toggle given an icon", () => {
  it("draws the icon where its word would be, and the word again while the press is unanswered", async () => {
    const send = vi.fn(() => new Promise<CommandReplyLike>(() => {}));
    render(
      <ConfiguredToggle
        handle={handle(send)}
        commandLabel="Toggle RCS"
        label="RCS"
        aria-label="RCS toggle"
        icon={<svg data-testid="bulb" />}
        toggle={{
          state: false,
          name: "RCS",
          word,
          words: ["RCS ON", "RCS OFF"],
          args: (base) =>
            typeof base === "boolean" ? { enabled: !base } : undefined,
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "RCS toggle" });
    expect(screen.getByTestId("bulb")).toBeInTheDocument();
    expect(button).not.toHaveTextContent("RCS OFF");

    await userEvent.click(button);

    expect(screen.queryByTestId("bulb")).toBeNull();
    expect(screen.getByRole("button")).toHaveTextContent("SENT");
  });
});

describe("a toggle whose reply arrives before the state frame", () => {
  async function pressThenConfirm() {
    const send = vi.fn(() => new Promise<CommandReplyLike>(() => {}));
    const predicting = handle(send, {
      status: { phase: "in-flight", requestId: "r1", accepted: true } as never,
      inFlight: [row("r1", { enabled: true })],
    });
    const confirmed = handle(send, {
      status: { phase: "confirmed", requestId: "r1" } as never,
    });
    const view = render(toggleButton(false, handle(send)));
    await act(async () => {
      screen.getByRole("button").click();
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    view.rerender(toggleButton(false, predicting));
    expect(screen.getByRole("button")).toHaveTextContent("RCS ON");
    return { view, confirmed };
  }

  it("keeps showing the state the press asked for until the reading moves", async () => {
    vi.useFakeTimers();
    try {
      const { view, confirmed } = await pressThenConfirm();
      view.rerender(toggleButton(false, confirmed));
      expect(screen.getByRole("button")).toHaveTextContent("RCS ON");
      view.rerender(toggleButton(true, confirmed));
      expect(screen.getByRole("button")).toHaveTextContent("RCS ON");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to the reading once the hold has passed with the reading unmoved", async () => {
    vi.useFakeTimers();
    try {
      const { view, confirmed } = await pressThenConfirm();
      view.rerender(toggleButton(false, confirmed));
      expect(screen.getByRole("button")).toHaveTextContent("RCS ON");
      await act(async () => {
        vi.advanceTimersByTime(5100);
      });
      expect(screen.getByRole("button")).toHaveTextContent("RCS OFF");
    } finally {
      vi.useRealTimers();
    }
  });
});
