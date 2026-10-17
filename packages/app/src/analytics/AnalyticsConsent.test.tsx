import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANALYTICS_CONSENT_KEY,
  AnalyticsConsentService,
} from "./AnalyticsConsentService";

afterEach(() => {
  localStorage.clear();
});

describe("AnalyticsConsentService", () => {
  beforeEach(() => localStorage.clear());

  it("starts off when nothing is persisted", () => {
    const svc = new AnalyticsConsentService();
    expect(svc.get()).toBeUndefined();
    expect(svc.isEnabled()).toBe(false);
  });

  it("persists a choice to its own localStorage slot", () => {
    const svc = new AnalyticsConsentService();
    svc.set("enabled");
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("enabled");
    // A fresh instance reads the persisted value.
    expect(new AnalyticsConsentService().isEnabled()).toBe(true);
  });

  it("notifies subscribers on change but not on no-op set", () => {
    const svc = new AnalyticsConsentService();
    const seen: (string | undefined)[] = [];
    svc.subscribe((v) => seen.push(v));
    svc.set("enabled");
    svc.set("enabled"); // unchanged: no fire
    svc.set("disabled");
    expect(seen).toEqual(["enabled", "disabled"]);
  });

  it("ignores a corrupt persisted value", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "garbage");
    expect(new AnalyticsConsentService().get()).toBeUndefined();
  });
});
