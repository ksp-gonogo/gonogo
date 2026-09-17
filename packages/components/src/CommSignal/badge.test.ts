import { describe, expect, it } from "vitest";
import { commSignalNoSignalBadge } from "./badge";

describe("commSignalNoSignalBadge", () => {
  it("shows no badge while the link is current", () => {
    expect(commSignalNoSignalBadge(false)).toEqual([]);
  });

  it("shows a warn-toned 'No signal' badge once the link is not current", () => {
    expect(commSignalNoSignalBadge(true)).toEqual([
      { id: "comm-signal-no-signal", label: "No signal", tone: "warn" },
    ]);
  });
});
