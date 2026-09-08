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
    // Every token in the union whether or not a mark uses it, so a client
    // switching over the vocabulary is exhaustive before the first mark lands.
    // It was written down here when rate-integration had none.
    expect(src).toMatch(/\| "kepler-propagation"/);
    expect(src).toMatch(/\| "linear-dead-reckoning"/);
    expect(src).toMatch(/\| "rate-integration"/);
  });

  it("gives a value served by two models one row each, with their own inputs", () => {
    /*
     * `altitudeAsl` is a conic above the atmosphere interface and a rate
     * integration below it. Two marks, so two rows, and the input lists differ:
     * the conic runs on the elements, the integration on the observed descent
     * rate and the sensed deceleration. A single row with a SET of bases could
     * not say that, which is why the attribute is AllowMultiple instead.
     */
    expect(src).toMatch(
      /\{ topic: "vessel\.flight", field: "altitudeAsl", basis: "kepler-propagation", inputs: \[ \{ topic: "vessel\.orbit", path: "" \}, \{ topic: "system\.bodies", path: "" \} \] \}/,
    );
    expect(src).toMatch(
      /\{ topic: "vessel\.flight", field: "altitudeAsl", basis: "rate-integration", inputs: \[ \{ topic: "", path: "verticalSpeed" \}, \{ topic: "", path: "gForce" \}, \{ topic: "system\.bodies", path: "" \} \] \}/,
    );
  });

  it("keeps that value ONCE in the fields view, which is the projection", () => {
    // Two models are still one field of `Pick<T, K>`. A duplicate here resolves
    // to the same key union and reads as a codegen fault to anyone who sees it.
    expect(src).toMatch(/"vessel\.flight": \["altitudeAsl", "orbitalSpeed"\]/);
  });
});
