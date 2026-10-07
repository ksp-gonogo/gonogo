import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import type { UplinkLoadOutcome } from "../uplinks/loaderState";
import { statusNeedsAttention, UplinkClientStatus } from "./UplinkStatus";

const loaded: UplinkLoadOutcome = {
  id: "widget-y",
  name: "Widget Y",
  version: "2.0.0",
  status: "loaded",
};

const clientRow = (outcome: UplinkLoadOutcome) =>
  render(
    <ul>
      <UplinkClientStatus outcome={outcome} />
    </ul>,
  );

describe("UplinkClientStatus", () => {
  it("says in words that an unvouched development client is running", async () => {
    const { container } = clientRow({ ...loaded, unvouchedDevClient: true });

    expect(
      screen.getByText(/Unvouched development client\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing checked this code before it ran/),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("says nothing of the kind for a client its plugin vouched for", () => {
    clientRow(loaded);
    expect(screen.queryByText(/Unvouched/)).toBeNull();
  });
});

describe("statusNeedsAttention", () => {
  it("is raised by a loaded client that is an unvouched development build", () => {
    expect(statusNeedsAttention(undefined, loaded)).toBe(false);
    expect(
      statusNeedsAttention(undefined, { ...loaded, unvouchedDevClient: true }),
    ).toBe(true);
  });
});
