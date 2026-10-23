import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ReservedText } from "./ReservedText";

describe("ReservedText", () => {
  it("is found by its shown text alone, the reserved texts holding room without being text", () => {
    const { container } = render(
      <ReservedText shown="ON" reserve={["ON", "OFF", "SENT", "LATE"]} />,
    );

    expect(container.textContent).toBe("ON");
    expect(screen.getByText("ON")).toBeTruthy();
    expect(screen.queryByText("SENT")).toBeNull();
    expect(container.querySelectorAll("[data-word]")).toHaveLength(4);
  });

  it("reserves each text once however often it is listed", () => {
    const { container } = render(
      <ReservedText shown="OFF" reserve={["ON", "OFF", "OFF"]} />,
    );

    expect(container.querySelectorAll("[data-word]")).toHaveLength(2);
  });
});
