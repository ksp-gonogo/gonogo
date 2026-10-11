import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  declineConsent,
  ensureConsent,
  ensureConsents,
  grantConsent,
  hasConsent,
  hasDeclined,
  revokeConsent,
  setConsentBatchPrompt,
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

  it("persists either answer, so a decline is not asked again", async () => {
    const prompt = vi.fn(async () => false);
    setConsentPrompt(prompt);
    expect(
      await ensureConsent({ id: "beta", name: "Beta", version: "1.0.0" }),
    ).toBe(false);
    expect(hasConsent("beta", "1.0.0")).toBe(false);
    expect(hasDeclined("beta", "1.0.0")).toBe(true);

    setConsentPrompt(async () => true);
    expect(
      await ensureConsent({ id: "beta", name: "Beta", version: "1.0.0" }),
    ).toBe(false);
    expect(prompt).toHaveBeenCalledOnce();

    // A new version is new bytes to trust, so it asks again.
    expect(
      await ensureConsent({ id: "beta", name: "Beta", version: "1.1.0" }),
    ).toBe(true);
    expect(hasConsent("beta", "1.1.0")).toBe(true);
  });

  it("asks every open question in one batch and none it already has an answer for", async () => {
    grantConsent("alpha", "1.0.0");
    declineConsent("gamma", "1.0.0");
    const batch = vi.fn(async (infos: readonly { id: string }[]) =>
      infos.map((info) => info.id === "beta"),
    );
    setConsentBatchPrompt(batch);

    const answers = await ensureConsents([
      { id: "alpha", name: "Alpha", version: "1.0.0" },
      { id: "beta", name: "Beta", version: "1.0.0" },
      { id: "gamma", name: "Gamma", version: "1.0.0" },
      { id: "delta", name: "Delta", version: "1.0.0" },
    ]);

    expect(answers).toEqual([true, true, false, false]);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0].map((info) => info.id)).toEqual([
      "beta",
      "delta",
    ]);
    expect(hasDeclined("delta", "1.0.0")).toBe(true);
  });

  it("revokeConsent clears a remembered answer of either kind so the next load re-asks", () => {
    grantConsent("alpha", "1.0.0");
    declineConsent("beta", "1.0.0");
    revokeConsent("alpha", "1.0.0");
    revokeConsent("beta", "1.0.0");
    expect(hasConsent("alpha", "1.0.0")).toBe(false);
    expect(hasDeclined("beta", "1.0.0")).toBe(false);
  });
});
