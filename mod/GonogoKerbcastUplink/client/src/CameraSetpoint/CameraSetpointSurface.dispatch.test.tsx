import { fireEvent, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { renderWithCommandClient } from "../test/commandHarness";
import { CameraSetpointSurface } from "./CameraSetpointSurface";

const bounds = {
  yawMin: -90,
  yawMax: 90,
  pitchMin: -45,
  pitchMax: 45,
  fovMin: 10,
  fovMax: 90,
};

describe("CameraSetpointSurface dispatch", () => {
  it("commits both absolute delayed commands with the dialled values", async () => {
    const { transport } = renderWithCommandClient(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={{ yaw: 10, pitch: -5, fov: 40 }}
        mode="staged"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    await waitFor(() => expect(transport.sentCommands).toHaveLength(2));

    const pan = transport.sentCommands.find(
      (c) => c.command === "kerbcast.setPan",
    );
    const fov = transport.sentCommands.find(
      (c) => c.command === "kerbcast.setFieldOfView",
    );
    expect(pan?.args).toEqual({ cameraId: 42, yaw: 10, pitch: -5 });
    expect(fov?.args).toEqual({ cameraId: 42, fieldOfView: 40 });
  });

  it("does not dispatch when gated (no-path)", () => {
    const { transport } = renderWithCommandClient(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={{ yaw: 0, pitch: 0, fov: 60 }}
        mode="no-path"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(transport.sentCommands).toHaveLength(0);
  });
});
