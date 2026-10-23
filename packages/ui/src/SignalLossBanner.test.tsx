import { value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { SignalLossBanner } from "./SignalLossBanner";

describe("SignalLossBanner", () => {
  it("renders nothing when signal is connected", () => {
    const { container } = render(
      <SignalLossBanner state="connected" elapsed={value("s", 0)} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows SIGNAL LOSS label when state is lost", () => {
    const { getByText } = render(
      <SignalLossBanner state="lost" elapsed={value("s", 0)} />,
    );
    expect(getByText("SIGNAL LOSS")).not.toBeNull();
  });

  it("shows PARTIAL CONTROL label when state is partial", () => {
    const { getByText } = render(
      <SignalLossBanner state="partial" elapsed={value("s", 0)} />,
    );
    expect(getByText("PARTIAL CONTROL")).not.toBeNull();
  });

  it("writes the elapsed game time in the game's own units", () => {
    const { container } = render(
      <SignalLossBanner state="lost" elapsed={value("s", 90)} />,
    );
    expect(container.textContent).toContain("T+");
    expect(container.textContent).toMatch(/1\s*min/);
  });
});
