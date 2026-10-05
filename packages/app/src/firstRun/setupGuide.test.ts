import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CKAN_UPLINK_FILTER, RUN_COMMAND } from "./setupGuide";

const HERE = dirname(fileURLToPath(import.meta.url));
// Spelled out as literals so the turbo input scan can see exactly which two files this reads.
const HOME_PAGE = resolve(HERE, "../../../../docs/homepage/index.html");
const README = resolve(HERE, "../../../../README.md");

/** The text of the one element carrying `id`, which is how the static page marks each command. */
function codeById(html: string, id: string): string | undefined {
  return new RegExp(`<code id="${id}">([^<]*)</code>`).exec(html)?.[1];
}

/** A multi-line shell command as the single line it runs as. */
function oneLine(command: string): string {
  return command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
}

describe("the run command is spelled once", () => {
  it("has no line continuation, so it pastes into every shell", () => {
    expect(RUN_COMMAND).not.toMatch(/[\\`^\n]/);
  });

  it("is the command the static home page prints", () => {
    const html = readFileSync(HOME_PAGE, "utf8");
    expect(codeById(html, "run-command")).toBe(RUN_COMMAND);
    expect(codeById(html, "ckan-filter")).toBe(CKAN_UPLINK_FILTER);
  });

  it("is the command the README prints, once its continuations are joined", () => {
    const block = /```bash\n(docker run[\s\S]*?)\n```/.exec(
      readFileSync(README, "utf8"),
    );
    expect(oneLine(block?.[1] ?? "")).toBe(RUN_COMMAND);
  });
});
