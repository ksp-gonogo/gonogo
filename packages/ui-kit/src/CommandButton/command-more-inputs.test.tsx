import {
  act,
  createFakeCommand,
  fireEvent,
  render,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FitLabelButton } from "../FitLabelButton";
import { JogWheel } from "../JogWheel";
import { MissionDateField, utOfParts } from "../MissionDateField";
import { SelectableRow } from "../SelectableRow";

describe("SelectableRow given a command", () => {
  it("sends on press, keeps its own selection, and draws SENT over the row", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <SelectableRow
        selected
        command={fake.handle.with(undefined, { label: "Select Mun" })}
      >
        Mun
      </SelectableRow>,
    );
    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("aria-pressed", "true");
    await user.click(row);
    expect(fake.sent).toEqual([{ args: undefined, label: "Select Mun" }]);
    expect(row).toHaveTextContent("SENT");
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  it("edges a refusal and sends nothing while unavailable", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    const { rerender } = render(
      <SelectableRow selected={false} command={fake.handle.with()}>
        Mun
      </SelectableRow>,
    );
    const row = screen.getByRole("button");
    await user.click(row);
    await act(async () => {
      fake.refuse("not now");
    });
    expect(row).toHaveAttribute("data-command-edge", "warn");
    rerender(
      <SelectableRow
        selected={false}
        command={fake.handle.with()}
        unavailable="No vessel"
      >
        Mun
      </SelectableRow>,
    );
    await user.click(screen.getByRole("button"));
    expect(fake.sent).toHaveLength(1);
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("FitLabelButton given a command", () => {
  it("sends on press and says SENT in place of the label without changing the label's place", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand({ answer: "hold" });
    render(
      <FitLabelButton
        label="Deploy"
        icon={<svg />}
        command={fake.handle.with(undefined, { label: "Deploy" })}
      />,
    );
    const button = screen.getByRole("button", { name: "Deploy" });
    await user.click(button);
    expect(fake.sent).toEqual([{ args: undefined, label: "Deploy" }]);
    expect(button).toHaveTextContent("SENT");
    expect(button).toHaveAttribute("aria-label", "Deploy");
  });

  it("sends nothing when it cannot be used", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand();
    render(
      <FitLabelButton
        label="Deploy"
        icon={<svg />}
        command={fake.handle.with()}
        unavailable="No vessel"
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(fake.sent).toEqual([]);
  });
});

describe("JogWheel given a command", () => {
  it("follows the hand while held and sends one command on release", async () => {
    const fake = createFakeCommand<{ pan: number }>({ answer: "hold" });
    render(
      <JogWheel
        aria-label="Pan"
        value={10}
        min={0}
        max={100}
        step={1}
        command={fake.handle.toArgs((pan: number) => ({ pan }))}
      />,
    );
    const wheel = screen.getByRole("slider", { name: "Pan" });
    wheel.setPointerCapture = () => {};
    wheel.releasePointerCapture = () => {};
    wheel.hasPointerCapture = () => false;
    fireEvent.pointerDown(wheel, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(wheel, { clientX: 8, pointerId: 1 });
    fireEvent.pointerMove(wheel, { clientX: 16, pointerId: 1 });
    expect(fake.sent).toEqual([]);
    expect(wheel).toHaveAttribute("aria-valuenow", "14");
    fireEvent.pointerUp(wheel, { pointerId: 1 });
    await act(async () => {});
    expect(fake.sent).toEqual([{ args: { pan: 14 }, label: undefined }]);
    expect(wheel).toHaveTextContent("SENT");
    expect(wheel).toHaveAttribute("aria-valuenow", "10");
  });

  it("sends each key press, and edges a refusal", async () => {
    const fake = createFakeCommand<{ pan: number }>({ answer: "hold" });
    render(
      <JogWheel
        aria-label="Pan"
        value={10}
        min={0}
        max={100}
        step={1}
        command={fake.handle.toArgs((pan: number) => ({ pan }))}
      />,
    );
    const wheel = screen.getByRole("slider", { name: "Pan" });
    fireEvent.keyDown(wheel, { key: "ArrowRight" });
    expect(fake.sent[0].args).toEqual({ pan: 11 });
    await act(async () => {
      fake.refuse("not now");
    });
    expect(wheel).toHaveAttribute("data-command-edge", "warn");
  });

  it("sends nothing while unavailable", () => {
    const fake = createFakeCommand<{ pan: number }>();
    render(
      <JogWheel
        aria-label="Pan"
        value={10}
        min={0}
        max={100}
        step={1}
        unavailable="No camera"
        command={fake.handle.toArgs((pan: number) => ({ pan }))}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(fake.sent).toEqual([]);
  });
});

describe("MissionDateField given a command", () => {
  const ut = utOfParts({ year: 2, day: 10, hour: 1, minute: 0, second: 0 });

  it("sends a nudge at once from the value commanded, and says SENT", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ ut: number }>({ answer: "hold" });
    const { container } = render(
      <MissionDateField
        label="Ignition"
        value={ut}
        steps={[60]}
        command={fake.handle.toArgs((u: number) => ({ ut: u }))}
      />,
    );
    await user.click(screen.getByRole("button", { name: /later by/ }));
    expect(fake.sent[0].args).toEqual({ ut: ut + 60 });
    expect(container).toHaveTextContent("SENT");
  });

  it("sends a typed field on Enter and not on each keystroke", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ ut: number }>({ answer: "hold" });
    render(
      <MissionDateField
        label="Ignition"
        value={ut}
        command={fake.handle.toArgs((u: number) => ({ ut: u }))}
      />,
    );
    const day = screen.getByRole("spinbutton", { name: "Ignition DAY" });
    await user.clear(day);
    await user.type(day, "20");
    expect(fake.sent).toEqual([]);
    await user.keyboard("{Enter}");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].args).toEqual({
      ut: utOfParts({ year: 2, day: 20, hour: 1, minute: 0, second: 0 }),
    });
  });

  it("sends nothing while unavailable, and edges a refusal", async () => {
    const user = userEvent.setup();
    const fake = createFakeCommand<{ ut: number }>({ answer: "hold" });
    render(
      <MissionDateField
        label="Ignition"
        value={ut}
        steps={[60]}
        command={fake.handle.toArgs((u: number) => ({ ut: u }))}
      />,
    );
    await user.click(screen.getByRole("button", { name: /earlier by/ }));
    await act(async () => {
      fake.refuse("not now");
    });
    expect(
      screen.getByRole("spinbutton", { name: "Ignition DAY" }),
    ).toHaveAttribute("data-command-edge", "warn");
  });
});
