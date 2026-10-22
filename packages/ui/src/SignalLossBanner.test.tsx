import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { SignalLossBanner } from "./SignalLossBanner";

describe("SignalLossBanner", () => {
  it("renders nothing when signal is connected", () => {
    const { container } = render(
      <SignalLossBanner state="connected" elapsedMs={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows SIGNAL LOSS label when state is lost", () => {
    const { getByText } = render(
      <SignalLossBanner state="lost" elapsedMs={0} />,
    );
    expect(getByText("SIGNAL LOSS")).not.toBeNull();
  });

  it("shows PARTIAL CONTROL label when state is partial", () => {
    const { getByText } = render(
      <SignalLossBanner state="partial" elapsedMs={0} />,
    );
    expect(getByText("PARTIAL CONTROL")).not.toBeNull();
  });

  it("formats elapsed time as mm:ss under an hour", () => {
    const { getByText } = render(
      <SignalLossBanner state="lost" elapsedMs={90_000} />,
    );
    expect(getByText("T+01:30")).not.toBeNull();
  });

  it("formats elapsed time as h:mm:ss at or above an hour", () => {
    const { getByText } = render(
      <SignalLossBanner state="lost" elapsedMs={3_661_000} />,
    );
    expect(getByText("T+1:01:01")).not.toBeNull();
  });
});
