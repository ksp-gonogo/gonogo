import { describe, expect, it } from "vitest";
import { vantageLabels } from "./vantageLabels";

describe("what each command centre is called in the vantage picker", () => {
  it("calls a centre by its name where no other shares it", () => {
    const labels = vantageLabels([
      { id: "ground:KSC", displayName: "KSC" },
      {
        id: "vessel:cec16dcd-0000-4000-8000-000000000001",
        displayName: "SALLY",
      },
    ]);

    expect(labels.get("ground:KSC")).toBe("KSC");
    expect(labels.get("vessel:cec16dcd-0000-4000-8000-000000000001")).toBe(
      "SALLY",
    );
  });

  it("tells centres of one name apart by the start of each one's own id", () => {
    const labels = vantageLabels([
      {
        id: "vessel:cec16dcd-0000-4000-8000-000000000001",
        displayName: "Sally-Hut 1",
      },
      {
        id: "vessel:7a3f09b2-0000-4000-8000-000000000002",
        displayName: "Sally-Hut 1",
      },
      {
        id: "vessel:0b44e1aa-0000-4000-8000-000000000003",
        displayName: "Sally-Hut 1",
      },
      { id: "ground:KSC", displayName: "KSC" },
    ]);

    expect(labels.get("vessel:cec16dcd-0000-4000-8000-000000000001")).toBe(
      "Sally-Hut 1 (cec1)",
    );
    expect(labels.get("vessel:7a3f09b2-0000-4000-8000-000000000002")).toBe(
      "Sally-Hut 1 (7a3f)",
    );
    expect(labels.get("vessel:0b44e1aa-0000-4000-8000-000000000003")).toBe(
      "Sally-Hut 1 (0b44)",
    );
    expect(labels.get("ground:KSC")).toBe("KSC");
  });

  it("takes more of the id where the first four characters are shared too", () => {
    const labels = vantageLabels([
      { id: "vessel:cec16dcd-1111", displayName: "Twin" },
      { id: "vessel:cec1ffff-2222", displayName: "Twin" },
    ]);

    expect(labels.get("vessel:cec16dcd-1111")).toBe("Twin (cec16)");
    expect(labels.get("vessel:cec1ffff-2222")).toBe("Twin (cec1f)");
  });

  it("falls back to the id for a centre with no name", () => {
    expect(vantageLabels([{ id: "ground:Far" }]).get("ground:Far")).toBe(
      "ground:Far",
    );
  });
});
