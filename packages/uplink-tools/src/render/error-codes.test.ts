import { describe, expect, it } from "vitest";
import { errorCodeSection } from "./docs";

describe("errorCodeSection", () => {
  it("lists each refinement under the root a client classifies it by", () => {
    const md = errorCodeSection([
      {
        id: "probe.notManaging",
        refines: "careerModeRequired",
        sentence: "the probe is not managing this save",
        meaning: "The probe is installed\n\nbut not managing this save.",
      },
    ]).join("\n");

    expect(md).toContain("## Error codes");
    expect(md).toContain(
      "| `probe.notManaging` | `careerModeRequired` | the probe is not managing this save | The probe is installed but not managing this save. |",
    );
  });

  it("writes nothing for an Uplink that declares none", () => {
    expect(errorCodeSection([])).toEqual([]);
  });
});
