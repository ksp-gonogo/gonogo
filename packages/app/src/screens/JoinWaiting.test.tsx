import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScopedStationIdentity } from "../stationIdentity";
import { JoinWaiting } from "./JoinWaiting";

describe("JoinWaiting", () => {
  it("lets the joiner rename the seat before the host approves", async () => {
    const user = userEvent.setup();
    render(
      <ScopedStationIdentity defaultName="Pilot" seat="pilot">
        <JoinWaiting code="ABCD" phase="pending" />
      </ScopedStationIdentity>,
    );
    await user.click(screen.getByRole("button", { name: "Pilot" }));
    await user.keyboard("{Control>}a{/Control}Ada{Enter}");
    expect(screen.getByRole("button", { name: "Ada" })).toBeInTheDocument();
  });
});
