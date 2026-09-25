import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INVOKE_PART_ACTION_COMMAND } from "./PartActionMenu";
import { PART_ACTIONS_TOPIC_PREFIX, partActionsTopic } from "./usePartActions";

/**
 * The part-action wire names, read out of the C# that publishes and handles
 * them. A widget-side constant compared with itself cannot go red on a rename,
 * and a renamed namespace is a subscription that silently receives nothing.
 */

const VIEW_PROVIDER = join(
  __dirname,
  "../../../../mod/Sitrep.Host/PartActionsViewProvider.cs",
);
const COMMAND_PROVIDER = join(
  __dirname,
  "../../../../mod/Sitrep.Host/PartActionCommandProvider.cs",
);

/** The value of `public const string <name> = "..."` in a C# source file. */
function csConst(path: string, name: string): string {
  const match = new RegExp(`public const string ${name} = "([^"]*)";`).exec(
    readFileSync(path, "utf8"),
  );
  if (!match) throw new Error(`${path} declares no const string ${name}`);
  return match[1];
}

describe("part actions name what the mod publishes and handles", () => {
  it("subscribes under the prefix PartActionsViewProvider publishes", () => {
    const prefix = csConst(VIEW_PROVIDER, "PartActionsPrefix");
    expect(PART_ACTIONS_TOPIC_PREFIX).toBe(prefix);
    expect(partActionsTopic(4242)).toBe(`${prefix}4242`);
  });

  it("invokes the command PartActionCommandProvider handles", () => {
    expect(INVOKE_PART_ACTION_COMMAND).toBe(
      csConst(COMMAND_PROVIDER, "InvokePartActionCommand"),
    );
  });
});
