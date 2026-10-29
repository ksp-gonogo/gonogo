import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import { commandTargetOf } from "./uplink-delays";

const REPORT = {
  activeVessel: ["vessel.control.stage"],
  elsewhere: [
    {
      command: "career.tech.unlock",
      centre: "ground:ksc",
      oneWaySeconds: value("s", 0),
    },
    {
      command: "career.tech.unlock",
      centre: "vessel:forward",
      oneWaySeconds: value("s", 3.5),
    },
    { command: "lens.aim", centre: "ground:ksc", oneWaySeconds: null },
  ],
};

describe("commandTargetOf", () => {
  it("says a command to the active craft goes there", () => {
    expect(commandTargetOf(REPORT, "vessel.control.stage")).toEqual({
      kind: "active-vessel",
    });
  });

  it("gives a career order its delay to the home command", () => {
    expect(
      commandTargetOf(REPORT, "career.tech.unlock", "vessel:forward"),
    ).toEqual({ kind: "elsewhere", seconds: 3.5 });
  });

  it("gives a target with no known delay no figure, never zero", () => {
    expect(commandTargetOf(REPORT, "lens.aim")).toEqual({
      kind: "elsewhere",
      seconds: null,
    });
  });

  it("gives no figure for a centre the report has no row for", () => {
    expect(
      commandTargetOf(REPORT, "career.tech.unlock", "ground:elsewhere"),
    ).toEqual({ kind: "elsewhere", seconds: null });
  });

  it("knows nothing of a command the report does not list, or of no report", () => {
    expect(commandTargetOf(REPORT, "science.unlisted")).toBeNull();
    expect(commandTargetOf(undefined, "vessel.control.stage")).toBeNull();
  });
});
