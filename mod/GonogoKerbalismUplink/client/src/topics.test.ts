import { getAllKnownTopicIds, isTopicId } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import "./topics";

describe("@ksp-gonogo/kerbalism topics", () => {
  it("registers the kerbalism.available bare-primitive Topic", () => {
    expect(isTopicId("kerbalism.available")).toBe(true);
    expect(getAllKnownTopicIds()).toContain("kerbalism.available");
  });
});
