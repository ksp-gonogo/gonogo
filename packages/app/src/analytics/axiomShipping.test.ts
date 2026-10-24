import { afterEach, describe, expect, it, vi } from "vitest";
import {
  axiomShipping,
  reportAxiomDeliveryFailure,
  resetAxiomDeliveryFailure,
} from "./axiomShipping";
import { createBrowserConsentController } from "./axiomTransportFactory";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAxiomDeliveryFailure();
});

describe("axiom shipping state", () => {
  it("says no-token for a build without a token, and installs nothing when consent is on", () => {
    vi.stubEnv("VITE_AXIOM_TOKEN", "");
    const controller = createBrowserConsentController();
    controller.apply(true);
    expect(controller.isInstalled()).toBe(false);
    expect(axiomShipping()).toBe("no-token");
  });

  it("is ready with a token and failing after a reported delivery failure", () => {
    vi.stubEnv("VITE_AXIOM_TOKEN", "xaat-test");
    expect(axiomShipping()).toBe("ready");
    reportAxiomDeliveryFailure();
    expect(axiomShipping()).toBe("failing");
  });
});
