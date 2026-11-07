import {
  act,
  createFakeCommand,
  render,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "../Button";
import { ToggleButton } from "../ToggleButton";

describe("ToggleButton given a command", () => {
  it("sends the opposite of the state it shows, through toArgs, and reads SENT until answered", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>({ answer: "hold" });
    render(
      <ToggleButton
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }), {
          label: "Toggle RCS",
        })}
        state={false}
        name="RCS"
      >
        {(shown) => (shown === true ? "RCS ON" : "RCS OFF")}
      </ToggleButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("RCS OFF");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(fake.sent).toEqual([
      { args: { enabled: true }, label: "Toggle RCS" },
    ]);
    expect(button).toHaveTextContent("SENT");
  });

  it("sends nothing while the state is unread", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>();
    render(
      <ToggleButton
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={null}
        name="RCS"
      >
        {() => "RCS"}
      </ToggleButton>,
    );
    await user.click(screen.getByRole("button"));
    expect(fake.sent).toEqual([]);
  });

  it("edges a refused press in the warning colour and keeps the state's own face", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>({ answer: "hold" });
    render(
      <ToggleButton
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={true}
        name="RCS"
      >
        {(shown) => (shown === true ? "RCS ON" : "RCS OFF")}
      </ToggleButton>,
    );
    const button = screen.getByRole("button");
    await user.click(button);
    await act(async () => {
      fake.refuse("the vessel is not controllable");
    });
    expect(button).toHaveAttribute("data-command-edge", "warn");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("RCS ON");
  });

  it("is dimmed and sends nothing while the stream to the mod is down", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>();
    fake.patch({ streamDown: true });
    render(
      <ToggleButton
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={false}
        name="RCS"
      >
        {() => "RCS"}
      </ToggleButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-stream", "down");
    await user.click(button);
    expect(fake.sent).toEqual([]);
  });
});

describe("IconButton given a command", () => {
  it("swaps its glyph for the send arrow while the press is unanswered", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <IconButton aria-label="Close hatch" command={fake.handle.with()}>
        <svg data-testid="glyph" />
      </IconButton>,
    );
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close hatch" }));
    expect(screen.queryByTestId("glyph")).toBeNull();
    expect(fake.sent).toHaveLength(1);
  });

  it("works as a toggle when given a command that sets a value", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>({ answer: "hold" });
    render(
      <IconButton
        aria-label="Toggle lamp"
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={false}
        name="Lamp"
      >
        <svg data-testid="lamp" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Toggle lamp" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(fake.sent[0].args).toEqual({ enabled: true });
  });
});

describe("Button given a command and an unavailable reason", () => {
  it("is aria-disabled with the reason as its name, sends nothing, and prints no reason", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand();
    render(
      <Button
        command={fake.handle.with(undefined, { label: "Recover" })}
        unavailable="No vessel in flight"
      >
        Recover
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Recover");
    await user.click(button);
    expect(fake.sent).toEqual([]);
    expect(screen.queryByText("No vessel in flight")).toBeNull();
  });
});

describe("Button width across phases", () => {
  it("is sized to the wider of its label and its longest word in every phase", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <Button command={fake.handle.with(undefined, { label: "Fly" })}>
        Fly Kerbal X
      </Button>,
    );
    const button = screen.getByRole("button");
    const sizer = () => [
      button.getAttribute("data-rest-label"),
      button.getAttribute("data-armed-label"),
    ];
    const atRest = sizer();
    // The sizers are the label and the widest word, and the longer of the two sets the width.
    expect(atRest).toEqual(["Fly Kerbal X", "No reply"]);
    await user.click(button);
    expect(button).toHaveTextContent("SENT");
    expect(sizer()).toEqual(atRest);
    await act(async () => {
      fake.refuse("not now");
    });
    expect(button).toHaveTextContent("Refused");
    expect(sizer()).toEqual(atRest);
  });
});
