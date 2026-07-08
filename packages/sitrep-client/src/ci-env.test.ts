import { describe, expect, it } from "vitest";
import { isCiEnvironment } from "./ci-env";

/**
 * M3 whole-branch review #2: the gate that decides whether a missing
 * fixture is a silent skip (dev machine) or a loud failure (CI) —
 * `map-topic.rawFieldResolution.fixture.test.ts`'s skip-cleanly contract
 * must not extend to CI. See that file's doc comment for the full "why".
 */
describe("isCiEnvironment", () => {
  it('true when CI="true" (GitHub Actions\' default)', () => {
    expect(isCiEnvironment({ CI: "true" })).toBe(true);
  });

  it('true when CI="1" (some other providers\' convention)', () => {
    expect(isCiEnvironment({ CI: "1" })).toBe(true);
  });

  it("false when CI is unset (a plain dev machine)", () => {
    expect(isCiEnvironment({})).toBe(false);
  });

  it('false for a falsy-looking but non-empty value ("false")', () => {
    expect(isCiEnvironment({ CI: "false" })).toBe(false);
  });
});
