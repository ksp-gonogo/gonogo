import {
  expectUplinkPageCurrent,
  loadRenderHosts,
} from "@ksp-gonogo/uplink-tools/page-check";
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
 * Every client-bearing Uplink carries this file, and `scripts/uplink-docs-gate.mjs`
 * is what says so. It has to run in the Uplink's own process rather than as one
 * repo-wide walk: the registries are global, so a second client loaded beside this
 * one would be read as a host of it and the page would describe both.
 */
describe("the generated Uplink page", () => {
  it("still describes what this Uplink registers", async () => {
    await loadRenderHosts();
    expectUplinkPageCurrent();
  });
});
