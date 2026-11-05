import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  CommandSlider,
  CommandStepper,
  commandValueMarks,
} from "./CommandValue";

const figure = (v: number) => `${v}`;

describe("commandValueMarks", () => {
  it("draws the expected value only where it differs from the command", () => {
    expect(
      commandValueMarks({ commanded: 0, expected: 1, step: 0.01 }),
    ).toEqual({ expected: 1, lastSeen: null, onCommanded: false });
    expect(
      commandValueMarks({ commanded: 0.5, expected: 0.5, step: 0.01 }).expected,
    ).toBeNull();
  });

  it("draws the last-seen value whenever it is given, and the expected one only where it differs from it too", () => {
    expect(
      commandValueMarks({
        commanded: 0.5,
        expected: 0,
        lastSeen: 0,
        step: 0.01,
      }),
    ).toEqual({ expected: null, lastSeen: 0, onCommanded: false });
    expect(
      commandValueMarks({ commanded: 300, lastSeen: 300, step: 10 }),
    ).toEqual({ expected: null, lastSeen: 300, onCommanded: true });
  });
});

describe("CommandSlider", () => {
  it("puts the thumb at the command and the marks on the track at their values", () => {
    const { container } = render(
      <CommandSlider
        aria-label="Throttle"
        commanded={0}
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
});

describe("CommandStepper", () => {
  it("steps from the command and marks the craft's expected value beside it", () => {
    let sent: number | null = null;
    const { container } = render(
      <CommandStepper
        commanded={340}
        expected={350}
        min={0}
        max={460}
        step={10}
        figure={figure}
        onChange={(v) => {
          sent = v;
        }}
        lowerLabel="Lower"
        raiseLabel="Raise"
      />,
    );
    expect(
      container.querySelector('[data-role="expected"]')?.textContent,
    ).toContain("350");
    screen.getByRole("button", { name: "Raise" }).click();
    expect(sent).toBe(350);
  });

  it("marks the command's own figure held when it is the value last seen", () => {
    const { container } = render(
      <CommandStepper
        commanded={300}
        lastSeen={300}
        lastSeenCaption="Blackout"
        min={0}
        max={460}
        step={10}
        figure={figure}
        onChange={() => {}}
        lowerLabel="Lower"
        raiseLabel="Raise"
      />,
    );
    const held = container.querySelectorAll("[data-held]");
    expect(held).toHaveLength(1);
    expect(held[0].textContent).toContain("300");
  });

  it("reads its worded absence while there is no value at all", () => {
    render(
      <CommandStepper
        commanded={null}
        unknown="RPM cap unknown"
        min={0}
        max={460}
        step={10}
        figure={figure}
        onChange={() => {}}
        lowerLabel="Lower"
        raiseLabel="Raise"
      />,
    );
    expect(screen.getByText("RPM cap unknown")).toBeTruthy();
  });
});
