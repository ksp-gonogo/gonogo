import { availableAtSeat } from "@ksp-gonogo/components";
import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "./CommcastComponent";

describe("Commcast's seats", () => {
  it("is offered aboard and on the ground from what it reads, with no override", () => {
    const def = getComponent("commcast");
    expect(def).toBeDefined();
    if (!def) return;
    expect(def.seats).toBeUndefined();
    expect(availableAtSeat(def, "pilot")).toBe(true);
    expect(availableAtSeat(def, "mission-control")).toBe(true);
  });
});
