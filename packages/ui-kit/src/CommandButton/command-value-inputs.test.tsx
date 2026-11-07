import {
  act,
  createFakeCommand,
  fireEvent,
  render,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Select } from "../Form";
import { Slider } from "../Slider";
import { Stepper } from "../Stepper";
import { Switch } from "../Switch";
import { TextField } from "../TextField";

const figure = (v: number) => `${v}`;

describe("Switch given a command", () => {
  it("sends the opposite of the state it shows and says SENT beside the track until answered", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>({ answer: "hold" });
    const { container } = render(
      <Switch
        aria-label="Auto-retarget"
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }), {
          label: "Auto-retarget",
        })}
        state={false}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Auto-retarget" }));
    expect(fake.sent).toEqual([
      { args: { enabled: true }, label: "Auto-retarget" },
    ]);
    expect(container).toHaveTextContent("SENT");
  });

  it("sends nothing while the state is unread, and edges a refusal in the warning colour", async () => {
    const user = userEvent.setup();
    const unread = createFakeCommand<{ enabled: boolean }>();
    const { unmount } = render(
      <Switch
        aria-label="Lamp"
        command={unread.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={null}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(unread.sent).toEqual([]);
    unmount();

    const fake = createFakeCommand<{ enabled: boolean }>({ answer: "hold" });
    const { container } = render(
      <Switch
        aria-label="Lamp"
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={true}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    await act(async () => {
      fake.refuse("the vessel is not controllable");
    });
    expect(
      container.querySelector('[data-command-edge="warn"]'),
    ).not.toBeNull();
    expect(container).toHaveTextContent("Refused");
  });

  it("sends nothing when the caller says it cannot be used", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ enabled: boolean }>();
    render(
      <Switch
        aria-label="Lamp"
        command={fake.handle.toArgs((on: boolean) => ({ enabled: on }))}
        state={false}
        unavailable="Lamp state not reported"
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(fake.sent).toEqual([]);
  });
});

describe("Select given a command", () => {
  it("sends the chosen value, shows what was asked while unanswered, and returns to the reported value after a refusal", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ mode: string }>({ answer: "hold" });
    render(
      <Select
        aria-label="Mode"
        value="a"
        command={fake.handle.toArgs((mode: string) => ({ mode }), {
          label: "Set mode",
        })}
      >
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Mode" });
    await user.selectOptions(select, "b");
    expect(fake.sent).toEqual([{ args: { mode: "b" }, label: "Set mode" }]);
    expect(select).toHaveValue("b");
    await act(async () => {
      fake.refuse("not now");
    });
    expect(select).toHaveValue("a");
    expect(select).toHaveAttribute("data-command-edge", "warn");
  });
});

describe("TextField given a command", () => {
  it("sends on Enter and not on each keystroke", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ name: string }>({ answer: "hold" });
    render(
      <TextField
        label="Name"
        value="Kerbal"
        command={fake.handle.toArgs((name: string) => ({ name }))}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Name" });
    await user.clear(field);
    await user.type(field, "Jeb");
    expect(fake.sent).toEqual([]);
    await user.keyboard("{Enter}");
    expect(fake.sent).toEqual([{ args: { name: "Jeb" }, label: undefined }]);
    expect(field).toHaveValue("Jeb");
  });
});

describe("Slider", () => {
  it("puts the thumb at the command and the marks on the track at their values", () => {
    const { container } = render(
      <Slider
        aria-label="Throttle"
        value={0}
        expected={1}
        lastSeen={0.5}
        lastSeenCaption="Blackout"
        min={0}
        max={1}
        step={0.01}
        figure={figure}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("slider", { name: "Throttle" })).toHaveValue("0");
    const expected = container.querySelector<HTMLElement>(
      '[data-role="expected"]',
    );
    const lastSeen = container.querySelector<HTMLElement>(
      '[data-role="last-seen"]',
    );
    expect(expected?.style.left).toContain("1 *");
    expect(lastSeen?.style.left).toContain("0.5 *");
    expect(lastSeen?.textContent).toContain("Blackout");
  });

  it("sends its command with the value it was moved to", () => {
    const fake = createFakeCommand<{ level: number }>({ answer: "hold" });
    render(
      <Slider
        aria-label="Gain"
        value={0.2}
        min={0}
        max={1}
        step={0.1}
        figure={figure}
        command={fake.handle.toArgs((level: number) => ({ level }))}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Gain" }), {
      target: { value: "0.6" },
    });
    expect(fake.sent).toEqual([{ args: { level: 0.6 }, label: undefined }]);
  });
});

describe("Stepper given a command", () => {
  const OPTIONS = [330, 340, 350, 360];

  it("steps from the command, marks the expected value beside it, and says SENT", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ rpm: number }>({ answer: "hold" });
    const { container } = render(
      <Stepper
        options={OPTIONS}
        value={340}
        expected={350}
        label="RPM cap"
        command={fake.handle.toArgs((rpm: number) => ({ rpm }))}
      />,
    );
    expect(
      container.querySelector('[data-role="expected"]')?.textContent,
    ).toContain("350");
    await user.click(screen.getByRole("button", { name: "Increase RPM cap" }));
    expect(fake.sent).toEqual([{ args: { rpm: 350 }, label: undefined }]);
    expect(container).toHaveTextContent("SENT");
  });

  it("marks the command's own figure held when it is the value last seen", () => {
    const fake = createFakeCommand<{ rpm: number }>();
    const { container } = render(
      <Stepper
        options={OPTIONS}
        value={340}
        lastSeen={340}
        label="RPM cap"
        command={fake.handle.toArgs((rpm: number) => ({ rpm }))}
      />,
    );
    const held = container.querySelectorAll("[data-held]");
    expect(held).toHaveLength(1);
    expect(held[0].textContent).toContain("340");
  });

  it("reads its worded absence while there is no value at all, and steps nowhere", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ rpm: number }>();
    render(
      <Stepper
        options={OPTIONS}
        value={null}
        unknown="RPM cap unknown"
        label="RPM cap"
        command={fake.handle.toArgs((rpm: number) => ({ rpm }))}
      />,
    );
    expect(screen.getByText("RPM cap unknown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Increase RPM cap" }));
    expect(fake.sent).toEqual([]);
  });
});
