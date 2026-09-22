import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_COMMAND_REPLY_TYPES } from "./__generated__/command-map";
import type {
  CommandResultOf,
  RepairOutcome,
  VantagePlanReply,
} from "./__generated__/contract";
import { wrapCommandReply } from "./command-reply-units";
import { isValue } from "./unit-system";

const GENERATED_COMMAND_MAP = join(
  dirname(fileURLToPath(import.meta.url)),
  "__generated__",
  "command-map.ts",
);

/**
 * The generated reply map's INTERFACE half, read as TEXT.
 *
 * `GeneratedCommandReplyMap` is an interface, so it is erased before anything
 * can compare against it at runtime, and a `test-d` assertion cannot check a
 * table of strings. Reading the file is the only instrument that can see the
 * interface and its runtime twin at once, and it is the same one
 * `wire-payload-coverage.mjs` already uses on this interface.
 */
function parseGeneratedReplyMap(): Record<string, string> {
  const source = readFileSync(GENERATED_COMMAND_MAP, "utf8");
  const block = /export interface GeneratedCommandReplyMap \{([^}]*)\n\}/.exec(
    source,
  );
  if (block === null) {
    throw new Error(
      `GeneratedCommandReplyMap not found in ${GENERATED_COMMAND_MAP}: the codegen renamed it, and this check has stopped checking anything`,
    );
  }
  const entries: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const entry = /^\s*"([^"]+)":\s*(.+);\s*$/.exec(line);
    if (entry !== null) entries[entry[1]] = entry[2];
  }
  return entries;
}

describe("the generated reply-type map's two halves", () => {
  const generated = parseGeneratedReplyMap();

  /*
   * The guard on the guard. A regex that stopped matching would parse an empty
   * map, every comparison below would hold vacuously, and the runtime half
   * could then say anything at all. 50 is well under the live count so ordinary
   * growth never trips it, and a parse that collapses can never reach it.
   */
  it("parsed the generated interface at all", () => {
    expect(Object.keys(generated).length).toBeGreaterThan(50);
  });

  it("names the same commands in both halves", () => {
    expect(Object.keys(GENERATED_COMMAND_REPLY_TYPES).sort()).toEqual(
      Object.keys(generated).sort(),
    );
  });

  it("names the same type for each of them, spelled identically", () => {
    expect({ ...GENERATED_COMMAND_REPLY_TYPES }).toEqual(generated);
  });
});

describe("wrapCommandReply", () => {
  it("gives a declared quantity on the reply its unit", () => {
    // `Pick`, not the whole reply: the generated interface mirrors the C#
    // record's static factories as members, and a fixture cannot supply those.
    // The unit under test is the one field, and naming it is what makes this an
    // assertion about the declared type rather than about a literal.
    const reply = wrapCommandReply<Pick<VantagePlanReply, "seededAtUt">>(
      "vessel.trajectory.forVantage",
      { seededAtUt: 4242 },
    );
    expect(isValue(reply.seededAtUt)).toBe(true);
    expect(reply.seededAtUt).toMatchObject({ magnitude: 4242, unit: "ut" });
  });

  it("reaches into a CommandResultOf envelope's payload", () => {
    const reply = wrapCommandReply<
      Pick<CommandResultOf<RepairOutcome>, "payload">
    >("vessel.repair", { payload: { repaired: true, kitsUsed: 3 } });
    expect(reply.payload?.kitsUsed).toMatchObject({
      magnitude: 3,
      unit: "count",
    });
  });

  it("leaves a primitive-payload envelope alone", () => {
    const reply = wrapCommandReply("vessel.control.stage", {
      success: true,
      payload: 4,
    });
    expect(reply).toEqual({ success: true, payload: 4 });
  });

  it("passes through a command it has never heard of", () => {
    const reply = { someNumber: 7 };
    expect(wrapCommandReply("uplink.made.this.up", reply)).toBe(reply);
  });
});
