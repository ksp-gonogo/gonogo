import {
  expectUplinkPageCurrent,
  loadHostWidgets,
} from "@ksp-gonogo/uplink-tools/page-check";
import { describe, it } from "vitest";
// Without the registrations the check would find no widgets and report the page correct.
import "./index";

/**
 * Proves the generated Uplink page still matches the registrations, without a browser.
 * It runs in the Uplink's own process because the registries are global: a second client loaded beside this one would be described too.
 */
describe("the generated Uplink page", () => {
  it("still describes what this Uplink registers", async () => {
    await loadHostWidgets();
    expectUplinkPageCurrent();
  });
});
