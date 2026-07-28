import { CameraKind, CrewLocation } from "@ksp-gonogo/kerbcast";
import { describe, expect, it } from "vitest";
import { selectKerbalCamera } from "./selectKerbalCamera";
import { makeCameraState } from "./testFixtures";

describe("selectKerbalCamera", () => {
  it("returns null with no cameras", () => {
    expect(selectKerbalCamera([], "Jebediah Kerman")).toBeNull();
  });

  it("finds a kerbal camera by matching cameraName", () => {
    const jeb = makeCameraState({
      flightId: 7,
      kind: CameraKind.Kerbal,
      cameraName: "Jebediah Kerman",
      crewLocation: CrewLocation.Seat,
    });
    const cameras = [makeCameraState({ flightId: 1 }), jeb];
    expect(selectKerbalCamera(cameras, "Jebediah Kerman")).toBe(jeb);
  });

  it("ignores part cameras with the same name coincidence", () => {
    const partCam = makeCameraState({
      flightId: 1,
      kind: CameraKind.Part,
      cameraName: "Jebediah Kerman",
    });
    expect(selectKerbalCamera([partCam], "Jebediah Kerman")).toBeNull();
  });

  it("ignores kerbal cameras for a different kerbal", () => {
    const bill = makeCameraState({
      flightId: 2,
      kind: CameraKind.Kerbal,
      cameraName: "Bill Kerman",
    });
    expect(selectKerbalCamera([bill], "Jebediah Kerman")).toBeNull();
  });

  it("finds the EVA camera the same way as the seated one, name is stable across the transition", () => {
    const evaJeb = makeCameraState({
      flightId: 9,
      kind: CameraKind.Kerbal,
      cameraName: "Jebediah Kerman",
      crewLocation: CrewLocation.Eva,
    });
    const found = selectKerbalCamera([evaJeb], "Jebediah Kerman");
    expect(found?.crewLocation).toBe(CrewLocation.Eva);
  });
});
