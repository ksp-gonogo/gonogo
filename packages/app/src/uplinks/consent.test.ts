import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureConsent,
  grantConsent,
  hasConsent,
  revokeConsent,
  setConsentPrompt,
} from "./consent";

const KEY = "gonogo.uplinkConsent";

beforeEach(() => {
  window.localStorage.clear();
  // Restore the safe default (deny) between tests that install a prompt.
  setConsentPrompt(async () => false);
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("consent store", () => {
  it("persists a grant per id@version", () => {
    expect(hasConsent("alpha", "1.0.0")).toBe(false);
    grantConsent("alpha", "1.0.0");
    expect(hasConsent("alpha", "1.0.0")).toBe(true);
    // A different version of the same id is a distinct, un-granted key.
    expect(hasConsent("alpha", "1.1.0")).toBe(false);
  });

  it("re-asks after a version bump (a new version is new bytes to trust)", async () => {
    grantConsent("alpha", "1.0.0");
    const prompt = vi.fn(async () => true);
    setConsentPrompt(prompt);

    // Remembered version short-circuits without prompting.
    expect(
      await ensureConsent({ id: "alpha", name: "Alpha", version: "1.0.0" }),
    ).toBe(true);
    expect(prompt).not.toHaveBeenCalled();

    // A bumped version must prompt again.
    expect(
      await ensureConsent({ id: "alpha", name: "Alpha", version: "2.0.0" }),
    ).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(hasConsent("alpha", "2.0.0")).toBe(true);
  });

  it("treats malformed storage as no consent", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(hasConsent("alpha", "1.0.0")).toBe(false);
  });

  it("persists the grant when the prompt returns true, and not when it returns false", async () => {
    setConsentPrompt(async () => false);
    expect(
      await ensureConsent({ id: "beta", name: "Beta", version: "1.0.0" }),
    ).toBe(false);
    expect(hasConsent("beta", "1.0.0")).toBe(false);

    setConsentPrompt(async () => true);
    expect(
      await ensureConsent({ id: "beta", name: "Beta", version: "1.0.0" }),
    ).toBe(true);
    expect(hasConsent("beta", "1.0.0")).toBe(true);
  });

  it("revokeConsent clears a remembered grant so the next load re-asks", () => {
    grantConsent("alpha", "1.0.0");
    expect(hasConsent("alpha", "1.0.0")).toBe(true);
    revokeConsent("alpha", "1.0.0");
    expect(hasConsent("alpha", "1.0.0")).toBe(false);
  });
});
