import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetFirstRunSetupForTests,
  hasSeenFirstRunSetup,
  markFirstRunSetupSeen,
} from "./firstRunSetup";

describe("firstRunSetup", () => {
  beforeEach(() => {
    __resetFirstRunSetupForTests();
  });

  it("is unseen before anything marks it", () => {
    expect(hasSeenFirstRunSetup()).toBe(false);
  });

  it("is seen after marking, and stays seen across repeated checks", () => {
    markFirstRunSetupSeen();
    expect(hasSeenFirstRunSetup()).toBe(true);
    expect(hasSeenFirstRunSetup()).toBe(true);
  });

  it("marking twice is idempotent (no throw, still seen)", () => {
    markFirstRunSetupSeen();
    markFirstRunSetupSeen();
    expect(hasSeenFirstRunSetup()).toBe(true);
  });

  it("the test reset makes it unseen again", () => {
    markFirstRunSetupSeen();
    __resetFirstRunSetupForTests();
    expect(hasSeenFirstRunSetup()).toBe(false);
  });
});
