import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { AwaitingSignal } from "./AwaitingSignal";

describe("AwaitingSignal with no host installed", () => {
  it("draws no time rather than throwing or a figure it cannot count down", () => {
    const { container } = render(<AwaitingSignal expectedIn={30} />);

    expect(container.textContent).toBe("Awaiting first signal");
  });
});
