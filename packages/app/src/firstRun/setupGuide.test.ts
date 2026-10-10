import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { say } from "./copy";
import {
  CKAN_UPLINK_FILTER,
  RUN_COMMAND,
  RUN_COMMAND_LINES,
  RUN_IMAGE_TAG,
  runCommandFor,
} from "./setupGuide";

const HERE = dirname(fileURLToPath(import.meta.url));
// Spelled out as literals so the turbo input scan can see exactly which two files this reads.
const HOME_PAGE = resolve(HERE, "../../../../docs/homepage/index.html");
const README = resolve(HERE, "../../../../README.md");

/** The text of the one element carrying `id`, which is how the static page marks each command. */
function codeById(html: string, id: string): string | undefined {
  return new RegExp(`<code id="${id}">([^<]*)</code>`).exec(html)?.[1];
}

/** A multi-line command as the single line it runs as, once `continuation` and the line break after it are taken out. */
function oneLine(command: string, continuation: string): string {
  return command
    .split(`${continuation}\n`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the run command is spelled once", () => {
  it("pulls the one image tag the wizard copy names", () => {
    expect(RUN_COMMAND.endsWith(`gonogo:${RUN_IMAGE_TAG}`)).toBe(true);
    expect(say("container.instruction", { tag: RUN_IMAGE_TAG })).toContain(
      `tagged ${RUN_IMAGE_TAG},`,
    );
  });

  it("has no line continuation in its source, so each shell's form adds only its own", () => {
    for (const line of RUN_COMMAND_LINES) expect(line).not.toMatch(/[\\`^\n]/);
    expect(RUN_COMMAND).toBe(RUN_COMMAND_LINES.join(" "));
  });

  it("breaks between flags and runs as the same one line in sh and in PowerShell", () => {
    const posix = runCommandFor("posix");
    const powershell = runCommandFor("powershell");
    expect(posix.split("\n")).toHaveLength(RUN_COMMAND_LINES.length);
    expect(oneLine(posix, "\\")).toBe(RUN_COMMAND);
    expect(oneLine(powershell, "`")).toBe(RUN_COMMAND);
    // A backslash continues nothing in PowerShell, and a backtick is a command substitution in sh.
    expect(powershell).not.toContain("\\");
    expect(posix).not.toContain("`");
    // The continuation has to be the last character on its line in both shells.
    for (const line of posix.split("\n").slice(0, -1))
      expect(line).toMatch(/ \\$/);
    for (const line of powershell.split("\n").slice(0, -1))
      expect(line).toMatch(/ `$/);
  });

  it("is the command the static home page prints, in its sh form", () => {
    const html = readFileSync(HOME_PAGE, "utf8");
    expect(codeById(html, "run-command")).toBe(runCommandFor("posix"));
    expect(codeById(html, "ckan-filter")).toBe(CKAN_UPLINK_FILTER);
  });

  it("is the command the README prints, in its sh form", () => {
    const block = /```bash\n(docker run[\s\S]*?)\n```/.exec(
      readFileSync(README, "utf8"),
    );
    expect(block?.[1]).toBe(runCommandFor("posix"));
  });
});
