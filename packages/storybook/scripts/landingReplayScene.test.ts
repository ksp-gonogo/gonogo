import { describe, expect, it } from "vitest";
import { builtOnce } from "./builtOnce";

describe("builtOnce", () => {
  it("builds a key's value on the first call and hands back that same object after, so a scene's props keep one identity across renders", () => {
    let builds = 0;
    const sceneFor = builtOnce((recording: string) => {
      builds += 1;
      return { fixture: {}, wrap: () => recording };
    });
    const first = sceneFor("crashfall");
    expect(sceneFor("crashfall")).toBe(first);
    expect(sceneFor("crashfall").wrap).toBe(first.wrap);
    expect(sceneFor("lowpass")).not.toBe(first);
    expect(builds).toBe(2);
  });
});
