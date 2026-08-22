import { expectUplinkPageCurrent } from "@ksp-gonogo/ui-kit/page-check";
import { describe, it } from "vitest";
// The client itself, so its registrations happen. The check reads the same
// registries the renderer reads; with nothing imported it would find an Uplink
// with no widgets and cheerfully report the page correct.
import "./index";

/**
 * The generated page, gated without a browser.
 *
 * `gonogo-uplink docs --check` asks two questions and only one of them needs
 * Chromium: whether the committed images are current does, whether the PROSE
 * still matches the registrations does not. This is the second question, run
 * here because this suite has already loaded the client under jsdom with a host
 * installed, which is exactly what the check needs and nothing more.
 *
 * So the prose half gates on every machine, and the picture half gates wherever
 * a browser exists. That split is for third-party authors more than for us: not
 * every Uplink author will have Playwright in their CI, and a gate an author
 * cannot run is a gate that rots.
 */
describe("the generated Uplink page", () => {
  it("still describes what this Uplink registers", () => {
    expectUplinkPageCurrent();
  });
});
