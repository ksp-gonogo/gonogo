import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetUplinkHubWizardFirstRunForTests,
  hasSeenUplinkHubWizard,
  markUplinkHubWizardSeen,
} from "./wizardFirstRun";

describe("wizardFirstRun", () => {
  beforeEach(() => {
    __resetUplinkHubWizardFirstRunForTests();
  });

  it("is unseen before anything marks it", () => {
    expect(hasSeenUplinkHubWizard()).toBe(false);
  });

  it("is seen after marking, and stays seen across repeated checks", () => {
    markUplinkHubWizardSeen();
    expect(hasSeenUplinkHubWizard()).toBe(true);
    expect(hasSeenUplinkHubWizard()).toBe(true);
  });

  it("marking twice is idempotent (no throw, still seen)", () => {
    markUplinkHubWizardSeen();
    markUplinkHubWizardSeen();
    expect(hasSeenUplinkHubWizard()).toBe(true);
  });

  it("the test reset makes it unseen again", () => {
    markUplinkHubWizardSeen();
    __resetUplinkHubWizardFirstRunForTests();
    expect(hasSeenUplinkHubWizard()).toBe(false);
  });
});
