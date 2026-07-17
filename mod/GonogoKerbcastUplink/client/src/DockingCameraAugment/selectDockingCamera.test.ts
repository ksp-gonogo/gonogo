import type { KerbcastCameraEntry } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { selectDockingCamera } from "./selectDockingCamera";

// Only the fields the selector reads; the wire entry has ~20 more.
function cam(
  cameraId: number,
  isDockingCamera?: boolean | null,
): KerbcastCameraEntry {
  return { cameraId, isDockingCamera } as KerbcastCameraEntry;
}

describe("selectDockingCamera", () => {
  it("returns null when there is no inventory yet or it is empty", () => {
    expect(selectDockingCamera(undefined)).toBeNull();
    expect(selectDockingCamera([])).toBeNull();
  });

  it("prefers a known docking camera over other cameras", () => {
    expect(
      selectDockingCamera([cam(1, false), cam(2, true), cam(3, false)]),
    ).toBe(2);
  });

  // The core of the nullable contract: DockingCameraFacts.cs distinguishes
  // "read the part, no docking module" (false) from "couldn't read the part"
  // (null). Collapsing null to false would rank an un-introspected camera
  // level with one we positively know is not a docking camera.
  it("ranks an UNKNOWN camera above a known-not-docking one", () => {
    expect(selectDockingCamera([cam(1, false), cam(2, null)])).toBe(2);
    expect(selectDockingCamera([cam(1, false), cam(2, undefined)])).toBe(2);
    // ...but a KNOWN docking camera still outranks an unknown one.
    expect(selectDockingCamera([cam(1, null), cam(2, true)])).toBe(2);
  });

  it("falls back to a known-not-docking camera rather than showing nothing", () => {
    // Parity with the built-in HudCamera this augment replaced: it picked
    // cameras[0] unconditionally. isDockingCamera sharpens the choice; it
    // must not shrink the pool to nothing.
    expect(selectDockingCamera([cam(7, false)])).toBe(7);
  });

  it("honours an explicit override so a pinned camera keeps working", () => {
    expect(selectDockingCamera([cam(1, true), cam(2, false)], 2)).toBe(2);
  });

  it("ignores a stale override whose camera is gone, rather than blanking", () => {
    expect(selectDockingCamera([cam(1, true), cam(2, false)], 99)).toBe(1);
  });

  it("skips entries with no cameraId — an unusable entry is not a candidate", () => {
    const noId = { isDockingCamera: true } as KerbcastCameraEntry;
    expect(selectDockingCamera([noId, cam(5, false)])).toBe(5);
    expect(selectDockingCamera([noId])).toBeNull();
  });

  it("is stable: the first camera wins a rank tie", () => {
    expect(selectDockingCamera([cam(3, true), cam(4, true)])).toBe(3);
  });
});
