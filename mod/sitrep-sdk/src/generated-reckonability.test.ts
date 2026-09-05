import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("./__generated__/reckonability.ts", import.meta.url)),
  "utf8",
);

/**
 * Asserted against the generated TEXT rather than the imported const, the same
 * way generated-control-channels.ts is: a stale artifact and a correct one
 * import identically, so a test that reads the values it is checking cannot tell
 * whether codegen ran.
 */
describe("generated reckonability.ts", () => {
  it("declares the dead-reckoned relative position with the velocity that moves it", () => {
    expect(src).toMatch(
      /\{ topic: "vessel\.target", field: "relativePosition", basis: "linear-dead-reckoning", inputs: \[ \{ topic: "", path: "relativeVelocity" \} \] \}/,
    );
  });

  it("splits a cross-topic input into its topic and its path", () => {
    // @vessel.orbit is a whole payload, @vessel.orbit#mu is one field of it, and
    // the two halves are what a consumer resolves without parsing.
    expect(src).toMatch(/\{ topic: "vessel\.orbit", path: "" \}/);
    expect(src).toMatch(/\{ topic: "vessel\.orbit", path: "mu" \}/);
  });

  it("exports both views and the basis vocabulary", () => {
    expect(src).toMatch(/export type GeneratedReckoningBasis/);
    expect(src).toMatch(/export const GENERATED_RECKONABLE_VALUES/);
    expect(src).toMatch(/export const GENERATED_RECKONABLE_FIELDS/);
  });

  it("carries every basis token the contract catalogues, not merely the used ones", () => {
    // rate-integration has no mark yet. It is in the union anyway, so a client
    // switching over the vocabulary is exhaustive before the first mark lands.
    expect(src).toMatch(/\| "kepler-propagation"/);
    expect(src).toMatch(/\| "linear-dead-reckoning"/);
    expect(src).toMatch(/\| "rate-integration"/);
  });
});
