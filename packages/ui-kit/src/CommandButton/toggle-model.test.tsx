import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CommandButton,
  type CommandButtonHandle,
  type CommandReplyLike,
} from "./CommandButton";

const OK: CommandReplyLike = { success: true };

function handle(
  send: CommandButtonHandle["send"],
  over: Partial<CommandButtonHandle> = {},
): CommandButtonHandle {
  return {
    send,
    inFlight: [],
    tags: railTagsForCommand("vessel.control.setRcs"),
    effectiveDelaySeconds: 8,
    ...over,
  };
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
    <CommandButton
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
      <CommandButton
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
