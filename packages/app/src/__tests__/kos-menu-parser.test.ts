import { describe, expect, it } from "vitest";
import { parseKosMenu, parseListChanged } from "../dataSources/kos-menu-parser";

const MENU_WITH_CPUS = `Terminal: type = XTERM-256COLOR, size = 123x18
__________________________________________________________________________________________________________________________
                        Menu GUI   Other
                        Pick Open Telnets  Vessel Name (CPU tagname)
                        ---- ---- -------  --------------------------------
                         [1]   no    0     Untitled Space Craft (KAL9000(name 1))
                         [2]   no    0     Untitled Space Craft (KAL9000(name 2))
                         [3]   no    0     Untitled Space Craft (CX-4181(name 3))
--------------------------------------------------------------------------------------------------------------------------
Choose a CPU to attach to by typing a selection number and pressing return/enter. Or enter [Q] to quit terminal server.

(After attaching, you can (D)etach and return to this menu by pressing Control-D as the first character on a new command
line.)
--------------------------------------------------------------------------------------------------------------------------`;

const MENU_NO_CPUS = `Terminal: type = XTERM-256COLOR, size = 123x18
__________________________________________________________________________________________________________________________
                                   Menu GUI   Other
                                   Pick Open Telnets  Vessel Name (CPU tagname)
                                   ---- ---- -------  --------------------------------
                                                                  <NONE>`;

describe("parseKosMenu", () => {
  it("returns null for non-menu text", () => {
    expect(parseKosMenu("hello kOS")).toBeNull();
    expect(parseKosMenu("")).toBeNull();
    expect(parseKosMenu("altitude=1000")).toBeNull();
  });

  it("parses a menu with CPUs into structured entries", () => {
    const result = parseKosMenu(MENU_WITH_CPUS);
    expect(result).not.toBeNull();
    expect(result?.cpus).toHaveLength(3);
    expect(result?.waitingForSelection).toBe(true);
  });

  it("parses CPU number, vesselName, partType, and tagname correctly", () => {
    const result = parseKosMenu(MENU_WITH_CPUS);
    expect(result?.cpus[0]).toEqual({
      number: 1,
      vesselName: "Untitled Space Craft",
      partType: "KAL9000",
      tagname: "name 1",
    });
    expect(result?.cpus[1]).toEqual({
      number: 2,
      vesselName: "Untitled Space Craft",
      partType: "KAL9000",
      tagname: "name 2",
    });
    expect(result?.cpus[2]).toEqual({
      number: 3,
      vesselName: "Untitled Space Craft",
      partType: "CX-4181",
      tagname: "name 3",
    });
  });

  it("parses a menu with no CPUs as empty list, not waiting for selection", () => {
    const result = parseKosMenu(MENU_NO_CPUS);
    expect(result).not.toBeNull();
    expect(result?.cpus).toHaveLength(0);
    expect(result?.waitingForSelection).toBe(false);
  });
});

describe("parseKosMenu — duplicate-name scenarios", () => {
  // Two KAL9000 cores added to a craft without the player setting a
  // KOSNameTag default to an empty inner tagname — kOS renders that as
  // the bare `()` pair below. The earlier regex required a non-empty
  // tagname group, so both rows were silently dropped and the compute
  // session waited forever on a selection that never came. Live repro:
  // see local_docs/TODO.md kOS reconnect-loop entry (2026-05-15
  // docking test, Rover-A had 2× KAL9000s).
  const MENU_DUPLICATE_EMPTY_TAGS = `Terminal: type = XTERM-256COLOR, size = 123x18
__________________________________________________________________________________________________________________________
                        Menu GUI   Other
                        Pick Open Telnets  Vessel Name (CPU tagname)
                        ---- ---- -------  --------------------------------
                         [1]   no    0     Rover-A (KAL9000())
                         [2]   no    0     Rover-A (KAL9000())
--------------------------------------------------------------------------------------------------------------------------
Choose a CPU to attach to by typing a selection number and pressing return/enter. Or enter [Q] to quit terminal server.`;

  const MENU_DUPLICATE_TAGS = `Terminal: type = XTERM-256COLOR, size = 123x18
__________________________________________________________________________________________________________________________
                        Menu GUI   Other
                        Pick Open Telnets  Vessel Name (CPU tagname)
                        ---- ---- -------  --------------------------------
                         [1]   no    0     Rover-A (KAL9000(ascent))
                         [2]   no    0     Rover-A (KAL9000(ascent))
--------------------------------------------------------------------------------------------------------------------------
Choose a CPU to attach to by typing a selection number and pressing return/enter. Or enter [Q] to quit terminal server.`;

  it("parses two CPUs with empty tagnames into two rows (not zero)", () => {
    const result = parseKosMenu(MENU_DUPLICATE_EMPTY_TAGS);
    expect(result).not.toBeNull();
    expect(result?.cpus).toHaveLength(2);
    expect(result?.cpus[0]).toEqual({
      number: 1,
      vesselName: "Rover-A",
      partType: "KAL9000",
      tagname: "",
    });
    expect(result?.cpus[1].number).toBe(2);
    expect(result?.cpus[1].tagname).toBe("");
    expect(result?.waitingForSelection).toBe(true);
  });

  it("parses two CPUs sharing the same non-empty tagname", () => {
    // Less common but possible — player intentionally names two cores
    // the same. We want both rows surfaced so discovery can flag the
    // collision; downstream selection picks the lowest menu number.
    const result = parseKosMenu(MENU_DUPLICATE_TAGS);
    expect(result?.cpus).toHaveLength(2);
    expect(result?.cpus.map((c) => c.tagname)).toEqual(["ascent", "ascent"]);
    expect(result?.cpus.map((c) => c.number)).toEqual([1, 2]);
  });
});

describe("parseListChanged", () => {
  it("detects the list-changed marker", () => {
    expect(parseListChanged("--(List of CPU's has Changed)--")).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(parseListChanged("altitude=1000")).toBe(false);
    expect(parseListChanged("")).toBe(false);
  });
});
