import { expectUplinkPageCurrent } from "@ksp-gonogo/ui-kit/page-check";
import { describe, it } from "vitest";
// The client itself, so its registrations happen. The check reads the same
// registries the renderer reads; with nothing imported it would find an Uplink
// with no widgets and cheerfully report the page correct.
import "./index";

/**
 * The generated page, gated without a browser. `docs/uplink-rendering.md` has the
 * argument; the short version is that whether the prose matches the registrations
 * is a registry read, and only the pictures need Chromium.
 *
 * This Uplink is the one that proves the gate earns its keep: a sibling branch
 * added a second widget here the same day, and with only the browser half running
 * in CI the page would have described one widget of two until someone happened to
 * look.
 */
describe("the generated Uplink page", () => {
  it("still describes what this Uplink registers", () => {
    expectUplinkPageCurrent();
  });
});
