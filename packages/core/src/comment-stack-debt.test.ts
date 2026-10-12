// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderAllowlist } from "../../../scripts/comment-stack-debt.mjs";
import {
  COMMENT_STACK_DEBT,
  MATCHER_REVISION,
  SCAN_FLOORS,
} from "./comment-stacks.allowlist";
import { emphasisIn } from "./doc-emphasis.scan";

const ALLOWLIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "comment-stacks.allowlist.ts",
);

/**
 * `node scripts/comment-stack-debt.mjs --update` is the documented way to
 * rewrite the comment-stack allowlist, so what it writes has to be a file the
 * other gates accept, starting with the doc comments it carries.
 */
describe("comment-stack-debt.mjs --update", () => {
  const rendered = renderAllowlist({
    entries: Object.entries(COMMENT_STACK_DEBT),
    filesFloor: SCAN_FLOORS.files,
    matcherRevision: MATCHER_REVISION,
  });

  it("writes the committed allowlist back unchanged from its own numbers", () => {
    expect(rendered).toBe(readFileSync(ALLOWLIST, "utf8"));
  });

  it("writes doc comments the emphasis scan accepts", () => {
    expect(emphasisIn(rendered, false)).toEqual([]);
  });
});
