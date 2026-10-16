import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerComponent } from "../api/registry";
import { clearContributions, registerContribution } from "./contributions";
import {
  closestSlotIds,
  isKnownSlotId,
  KNOWN_SLOT_IDS,
  resetSlotWarnings,
} from "./slot-ids";

afterEach(() => {
  clearContributions();
  clearRegistry();
  resetSlotWarnings();
  vi.restoreAllMocks();
});

const contribution = (contributes: string) => ({
  id: "my-uplink.cme",
  contributes,
  owner: { id: "my-uplink", name: "My Uplink" },
  compute: () => null,
});

describe("closestSlotIds", () => {
  it("offers the slot with the same trailing segment under another widget", () => {
    expect(closestSlotIds("system-view.entities", KNOWN_SLOT_IDS)).toContain(
      "tracking-station.entities",
    );
  });

  it("offers a slot one letter away", () => {
    expect(closestSlotIds("ground-track.overlai", KNOWN_SLOT_IDS)[0]).toBe(
      "ground-track.overlay",
    );
  });
});

describe("isKnownSlotId", () => {
  it("knows a declared slot and a standard segment of a registered widget", () => {
    registerComponent({
      id: "my-widget",
      name: "w",
      description: "d",
      tags: [],
      component: () => null,
    } as never);
    expect(isKnownSlotId("tracking-station.entities")).toBe(true);
    expect(isKnownSlotId("my-widget.badges")).toBe(true);
    expect(isKnownSlotId("other-widget.badges")).toBe(false);
  });

  it("knows a slot a registered widget declares for itself", () => {
    registerComponent({
      id: "mine",
      name: "w",
      description: "d",
      tags: [],
      component: () => null,
      contributionSlots: ["mine.lines"],
    } as never);
    expect(isKnownSlotId("mine.lines")).toBe(true);
  });
});

describe("registerContribution naming an unknown slot", () => {
  it("warns with the id, the Uplink and the close slots, and still registers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerContribution(contribution("system-view.entities") as never);
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("system-view.entities");
    expect(message).toContain("my-uplink.cme");
    expect(message).toContain("My Uplink (my-uplink)");
    expect(message).toContain("tracking-station.entities");
  });

  it("stays quiet for a declared slot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerContribution(contribution("tracking-station.entities") as never);
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });

  it("waits for the widget that declares the slot when it registers after", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerContribution(contribution("late.lines") as never);
    registerComponent({
      id: "late",
      name: "w",
      description: "d",
      tags: [],
      component: () => null,
      contributionSlots: ["late.lines"],
    } as never);
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("KNOWN_SLOT_IDS", () => {
  it("lists every member of SlotRegistry and ContributionRegistry the sdk declares", () => {
    const declared = new Set<string>();
    for (const name of ["slots.ts", "contribution-slots.ts", "plots.ts"]) {
      const path = join(import.meta.dirname, "..", "api", name);
      const file = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: import("typescript").Node): void => {
        if (
          ts.isInterfaceDeclaration(node) &&
          (node.name.text === "SlotRegistry" ||
            node.name.text === "ContributionRegistry")
        ) {
          for (const member of node.members) {
            const n = member.name;
            if (n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n))) {
              declared.add(n.text);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(declared.size).toBeGreaterThan(40);
    expect([...declared].sort()).toEqual([...KNOWN_SLOT_IDS].sort());
  });
});
