import {
  type AnyBoundCommand,
  type BoundCommand,
  commandSet,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  createFakeCommand,
  render,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { commandRefusalSentence } from "../CommandDelay/commandRefusalSentence";
import { useCommandControl } from "./commandControl";

function Control({ command }: { command: AnyBoundCommand }) {
  const state = useCommandControl({
    command,
  });
  return (
    <>
      <button type="button" onClick={() => state.press(false)}>
        press
      </button>
      <output>{state.phase}</output>
      <output aria-label="reason">{state.refusalText ?? "none"}</output>
    </>
  );
}

describe("useCommandControl with a bound command", () => {
  it("sends the bound arguments under the bound label, running before at the dispatch", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ index: number }>();
    const before = vi.fn();
    const onConfirmed = vi.fn();
    render(
      <Control
        command={fake.handle.with(() => ({ index: 3 }), {
          label: "Warp",
          before,
          onConfirmed,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "press" }));
    expect(fake.sent).toEqual([{ args: { index: 3 }, label: "Warp" }]);
    expect(before).toHaveBeenCalledWith({ index: 3 });
    expect(onConfirmed).toHaveBeenCalledWith({ success: true });
  });

  it("hands onRefused the sentence the control shows, and onRejected the error", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    const onRefused = vi.fn();
    const onRejected = vi.fn();
    render(
      <Control
        command={fake.handle.with(undefined, {
          label: "Deploy",
          onRefused,
          onRejected,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "press" }));
    await act(async () => {
      fake.refuse("the experiment has already been run");
    });
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onRefused.mock.calls[0][0]).toContain(
      "the experiment has already been run",
    );
    expect(screen.getByLabelText("reason")).toHaveTextContent(
      onRefused.mock.calls[0][0],
    );
    expect(typeof commandRefusalSentence).toBe("function");
  });

  it("sends every member of a set and reports it to onSettled", async () => {
    const user = userEvent.setup();
    const a = createFakeCommand<{ n: number }>();
    const b = createFakeCommand<{ n: number }>();
    const onSettled = vi.fn();
    render(
      <Control
        command={commandSet(
          [a.handle.with({ n: 1 }), b.handle.with({ n: 2 })],
          {
            onSettled,
          },
        )}
      />,
    );
    await user.click(screen.getByRole("button", { name: "press" }));
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(onSettled).toHaveBeenCalledWith({
      total: 2,
      confirmed: 2,
      failed: 0,
    });
  });

  it("is blocked by a member the game has already said it will refuse, and sends nothing", async () => {
    const user = userEvent.setup();
    const a = createFakeCommand();
    const b = createFakeCommand();
    b.patch({
      gate: { blocked: true, reason: "Out of range" } as never,
      gateStopsPress: true,
    });
    render(
      <Control command={commandSet([a.handle.with(), b.handle.with()])} />,
    );
    await user.click(screen.getByRole("button", { name: "press" }));
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(0);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("blocked");
  });

  it("sends a delayed set whose member the game is likely to refuse, as advice", async () => {
    const user = userEvent.setup();
    const a = createFakeCommand();
    const b = createFakeCommand();
    b.patch({ gate: { blocked: true, reason: "Out of range" } as never });
    render(
      <Control command={commandSet([a.handle.with(), b.handle.with()])} />,
    );
    await user.click(screen.getByRole("button", { name: "press" }));
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it("does not block a set for a delay or a held send status", async () => {
    const user = userEvent.setup();
    const a = createFakeCommand();
    a.patch({
      sendStatus: { contact: { kind: "none" }, arrival: "likely-lost" },
    });
    render(<Control command={commandSet([a.handle.with()])} />);
    await user.click(screen.getByRole("button", { name: "press" }));
    expect(a.sent).toHaveLength(1);
  });
});
