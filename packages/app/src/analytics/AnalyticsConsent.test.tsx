import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "./AnalyticsConsentModal";
import {
  ANALYTICS_CONSENT_KEY,
  AnalyticsConsentService,
} from "./AnalyticsConsentService";

afterEach(() => {
  localStorage.clear();
});

describe("AnalyticsConsentService", () => {
  beforeEach(() => localStorage.clear());

  it("starts unanswered when nothing is persisted", () => {
    const svc = new AnalyticsConsentService();
    expect(svc.get()).toBeUndefined();
    expect(svc.hasAnswered()).toBe(false);
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
    svc.set("enabled"); // unchanged — no fire
    svc.set("disabled");
    expect(seen).toEqual(["enabled", "disabled"]);
  });

  it("ignores a corrupt persisted value", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "garbage");
    expect(new AnalyticsConsentService().get()).toBeUndefined();
  });
});

describe("AnalyticsConsentModal", () => {
  beforeEach(() => localStorage.clear());

  it("persists 'enabled' and calls onResolved when Enable is clicked", async () => {
    const svc = new AnalyticsConsentService();
    let resolved = false;
    render(
      <AnalyticsConsentModal
        service={svc}
        onResolved={() => {
          resolved = true;
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(svc.isEnabled()).toBe(true));
    expect(resolved).toBe(true);
  });

  it("persists 'disabled' when Decline is clicked", async () => {
    const svc = new AnalyticsConsentService();
    render(<AnalyticsConsentModal service={svc} />);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(svc.get()).toBe("disabled"));
    expect(svc.isEnabled()).toBe(false);
  });

  it("exposes a dialog with an accessible name", () => {
    render(<AnalyticsConsentModal service={new AnalyticsConsentService()} />);
    expect(
      screen.getByRole("dialog", { name: /improve gonogo/i }),
    ).toBeInTheDocument();
  });
});
