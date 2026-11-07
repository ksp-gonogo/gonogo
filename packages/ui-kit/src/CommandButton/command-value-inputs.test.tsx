import {
  act,
  createFakeCommand,
  fireEvent,
  render,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ActionMenu } from "../ActionMenu";
import { Select } from "../Form";
import { Row } from "../Row";
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

describe("Slider given a command, once the hand lets go", () => {
  it("stays on the value asked while the mod has not answered, then returns to the value reported when it is refused, keeping the warning edge", async () => {
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
    const slider = screen.getByRole("slider", { name: "Gain" });
    fireEvent.change(slider, { target: { value: "0.6" } });
    expect(slider).toHaveValue("0.6");
    await act(async () => {
      fake.refuse("not now");
    });
    expect(slider).toHaveValue("0.2");
    expect(slider).toHaveAttribute("data-command-edge", "warn");
  });
});

describe("Stepper with no value", () => {
  it("steps onto the first option from either button, or onto startAt when given", async () => {
    const user = userEvent.setup();
    const seen: number[] = [];
    const { rerender } = render(
      <Stepper
        options={[64, 128, 256]}
        value={null}
        label="Steps"
        onChange={(v) => seen.push(v)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Increase Steps" }));
    await user.click(screen.getByRole("button", { name: "Decrease Steps" }));
    expect(seen).toEqual([64, 64]);
    rerender(
      <Stepper
        options={[64, 128, 256]}
        value={null}
        startAt={128}
        label="Steps"
        onChange={(v) => seen.push(v)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Increase Steps" }));
    expect(seen).toEqual([64, 64, 128]);
  });

  it("steps onto the lowest value of a range, or zero where it has none", async () => {
    const user = userEvent.setup();
    const seen: number[] = [];
    const { rerender } = render(
      <Stepper<number>
        min={10}
        max={100}
        step={10}
        value={null}
        label="Limit"
        onChange={(v) => seen.push(v)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Increase Limit" }));
    rerender(
      <Stepper<number>
        step={5}
        value={null}
        label="Limit"
        onChange={(v) => seen.push(v)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Increase Limit" }));
    expect(seen).toEqual([10, 0]);
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

  it("reads its worded absence while there is no value at all, and the first step lands on the first option", async () => {
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
    expect(fake.sent).toEqual([{ args: { rpm: 330 }, label: undefined }]);
  });
});

describe("Row and menu item given a command", () => {
  /* jsdom has no layout, so the width itself is measured in the render probe; here the slot that holds it is checked. */
  const slotOf = (el: HTMLElement) =>
    Array.from(
      el.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'),
    ).pop();

  it("a Row holds the room of its longest word at rest and while sent", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <Row as="button" command={fake.handle.with(undefined, { label: "Go" })}>
        Mun
      </Row>,
    );
    const row = screen.getByRole("button");
    const rest = slotOf(row);
    expect(rest).toBeDefined();
    expect(getComputedStyle(rest as HTMLElement).minWidth).toBe("10ch");
    expect(rest).toHaveTextContent("");
    await user.click(row);
    const sent = slotOf(row);
    expect(sent).toHaveTextContent("SENT");
    expect(getComputedStyle(sent as HTMLElement).minWidth).toBe("10ch");
  });

  it("a menu item holds the same room, and draws its warning edge on its own border", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <ActionMenu
        aria-label="Part"
        items={[
          {
            key: "cut",
            label: "Cut chute",
            command: fake.handle.with(undefined, { label: "Cut chute" }),
          },
        ]}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    const item = screen.getByRole("menuitem", { name: /Cut chute/ });
    expect(getComputedStyle(slotOf(item) as HTMLElement).minWidth).toBe("10ch");
    expect(getComputedStyle(item).borderTopWidth).toBe("1px");
    await user.click(item);
    await act(async () => {
      fake.refuse("not now");
    });
    expect(item).toHaveAttribute("data-command-edge", "warn");
    // The edge is the shared border-colour rule, on the item's own 1px border, so its box keeps its size.
    expect(getComputedStyle(item).borderTopWidth).toBe("1px");
  });
});
