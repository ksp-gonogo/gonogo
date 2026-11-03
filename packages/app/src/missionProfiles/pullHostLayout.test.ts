import { describe, expect, it } from "vitest";
import { pulledLayoutName, withStationBindings } from "./pullHostLayout";

const key = { deviceId: "kb", inputId: "KeyW" } as never;

describe("pulledLayoutName", () => {
  it("keeps the name when no layout here has it", () => {
    expect(pulledLayoutName("Launch", ["Orbit"])).toBe("Launch");
  });

  it("marks a name a layout here already has as the main screen's", () => {
    expect(pulledLayoutName("Launch", ["launch"])).toBe("Launch (main screen)");
  });

  it("numbers the marked name when that is taken too", () => {
    expect(pulledLayoutName("Launch", ["Launch", "Launch (main screen)"])).toBe(
      "Launch (main screen) 2",
    );
  });
});

describe("withStationBindings", () => {
  it("puts the station's bindings on matching widgets only", () => {
    const pulled = [
      { i: "a", componentId: "warp-control" },
      { i: "b", componentId: "navball" },
    ];
    const station = [
      {
        i: "x",
        componentId: "warp-control",
        inputMappings: { "step-up": key },
      },
    ];
    expect(withStationBindings(pulled, station)).toEqual([
      {
        i: "a",
        componentId: "warp-control",
        inputMappings: { "step-up": key },
      },
      { i: "b", componentId: "navball" },
    ]);
  });

  it("gives each station item to one pulled widget", () => {
    const pulled = [
      { i: "a", componentId: "warp-control" },
      { i: "b", componentId: "warp-control" },
    ];
    const station = [
      { i: "x", componentId: "warp-control", inputMappings: { stop: key } },
    ];
    const out = withStationBindings(pulled, station);
    expect(out[0]?.inputMappings).toEqual({ stop: key });
    expect(out[1]?.inputMappings).toBeUndefined();
  });
});
