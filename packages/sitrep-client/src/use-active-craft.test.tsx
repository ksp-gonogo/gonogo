import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { isOtherCraftsReading, useActiveCraftId } from "./use-active-craft";

function CraftProbe() {
  return <div>{`active:${useActiveCraftId() ?? "none"}`}</div>;
}

describe("useActiveCraftId", () => {
  it("names the craft the newest comms.delay is about, and none for the session", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    render(
      <TelemetryProvider client={client}>
        <CraftProbe />
      </TelemetryProvider>,
    );
    expect(screen.getByText("active:none")).toBeTruthy();

    act(() => {
      transport.emit("comms.delay", { meta: { source: "vessel:probe" } });
    });
    expect(screen.getByText("active:probe")).toBeTruthy();

    act(() => {
      transport.emit("comms.delay", { meta: { source: "game" } });
    });
    expect(screen.getByText("active:none")).toBeTruthy();
  });
});

describe("isOtherCraftsReading", () => {
  it("is true only for a reading naming a craft other than the active one", () => {
    expect(isOtherCraftsReading("a", { source: "vessel:b" })).toBe(true);
    expect(isOtherCraftsReading("a", { source: "vessel:a" })).toBe(false);
    expect(isOtherCraftsReading("a", { source: "game" })).toBe(false);
    expect(isOtherCraftsReading("a", undefined)).toBe(false);
    expect(isOtherCraftsReading(undefined, { source: "vessel:b" })).toBe(false);
  });
});
