import { describe, expect, it } from "vitest";
import { isNewer, modMatchesApp, modVersionText } from "./releaseCheck";

describe("isNewer", () => {
  it("orders releases by number", () => {
    expect(isNewer("1.4.0", "1.3.9")).toBe(true);
    expect(isNewer("1.3.9", "1.4.0")).toBe(false);
    expect(isNewer("1.4.0", "1.4.0")).toBe(false);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });

  it("puts a release ahead of a candidate for it", () => {
    expect(isNewer("1.4.0", "1.4.0-rc.abc1234")).toBe(true);
    expect(isNewer("1.4.0-rc.abc1234", "1.4.0")).toBe(false);
    expect(isNewer("1.4.0", "1.5.0-rc.abc1234")).toBe(false);
  });

  it("has no answer for a version it cannot read", () => {
    expect(isNewer("latest", "1.0.0")).toBeUndefined();
  });
});

describe("modMatchesApp", () => {
  it("matches a release tag to the same app release", () => {
    expect(modMatchesApp("v1.4.0", "1.4.0")).toBe(true);
    expect(modMatchesApp("v1.3.0", "1.4.0")).toBe(false);
  });

  it("matches a candidate label to the app built from the same commit", () => {
    expect(modMatchesApp("rc-abc1234", "1.4.0-rc.abc1234")).toBe(true);
    expect(modMatchesApp("rc-abc1234", "1.4.0-rc.def5678")).toBe(false);
    expect(modMatchesApp("rc-abc1234", "1.4.0")).toBe(false);
  });

  it("has no answer when the mod reports nothing it can read", () => {
    expect(modMatchesApp(null, "1.4.0")).toBeUndefined();
    expect(modMatchesApp(undefined, "1.4.0")).toBeUndefined();
    expect(modMatchesApp("nightly", "1.4.0")).toBeUndefined();
  });
});

describe("modVersionText", () => {
  it("drops a release tag's v and leaves a candidate label alone", () => {
    expect(modVersionText("v1.4.0")).toBe("1.4.0");
    expect(modVersionText("rc-abc1234")).toBe("rc-abc1234");
  });
});
