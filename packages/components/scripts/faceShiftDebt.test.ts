import { describe, expect, it } from "vitest";
import { faceDebtKey, seedFaceDebt, settleFaceDebt } from "./faceShiftDebt";

const MOVED =
  'navball @ landscape-12x12 (rest): button "SAS" face "sent": div "Mode" moved 0.0, 14.0px';

describe("faceDebtKey", () => {
  it("keys a finding by widget and control, whatever the scene or face", () => {
    expect(faceDebtKey(MOVED)).toBe('navball|button "SAS"');
    expect(faceDebtKey(MOVED.replace('"sent"', '"refused"'))).toBe(
      'navball|button "SAS"',
    );
  });

  it("returns undefined for a line that is not a face finding", () => {
    expect(faceDebtKey("something else")).toBeUndefined();
  });
});

describe("settleFaceDebt", () => {
  const debt = { 'navball|button "SAS"': "sent: Mode moved" };

  it("covers a finding the debt names and reports the rest", () => {
    const other = MOVED.replace("navball", "twr");
    const out = settleFaceDebt(
      [MOVED, other],
      new Set(["navball", "twr"]),
      debt,
    );
    expect(out.covered).toBe(1);
    expect(out.reported).toEqual([other]);
    expect(out.stale).toEqual([]);
  });

  it("names an entry whose widget was checked and reported nothing", () => {
    const out = settleFaceDebt([], new Set(["navball"]), debt);
    expect(out.stale).toEqual(['navball|button "SAS"']);
  });

  it("leaves an entry alone when its widget was not part of the run", () => {
    expect(settleFaceDebt([], new Set(["twr"]), debt).stale).toEqual([]);
  });
});

describe("seedFaceDebt", () => {
  it("writes one entry per control, preferring a reason that names its element", () => {
    const bare = MOVED.replace('div "Mode"', "div");
    const lines = seedFaceDebt([bare, MOVED]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"navball|button \\"SAS\\""');
    expect(lines[0]).toContain('div \\"Mode\\" moved');
  });
});
