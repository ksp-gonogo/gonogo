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

// End-to-end through the real hook + client + stub wire: the delay gate decides
// whether the surface shows at all, and a dial-then-commit fires the two
// absolute delayed commands with the dialled values. Only the wire is a stub.
describe("delayed camera control, end to end", () => {
  it("live: surface hidden, nothing dispatched", () => {
    const { transport } = renderWithCommandClient(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={{ yaw: 0, pitch: 0, fov: 60 }}
        mode="live"
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
    expect(transport.sentCommands).toHaveLength(0);
  });

  it("staged: dial then commit dispatches both delayed commands", async () => {
    const { transport } = renderWithCommandClient(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={{ yaw: 0, pitch: 0, fov: 60 }}
        mode="staged"
      />,
    );
    // Dial yaw 0 -> 1 with the keyboard, then commit.
    fireEvent.keyDown(screen.getByRole("slider", { name: /yaw/i }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    await waitFor(() => expect(transport.sentCommands).toHaveLength(2));

    const pan = transport.sentCommands.find(
      (c) => c.command === "kerbcast.setPan",
    );
    const fov = transport.sentCommands.find(
      (c) => c.command === "kerbcast.setFieldOfView",
    );
    expect(pan?.args).toEqual({ cameraId: 42, yaw: 1, pitch: 0 });
    expect(fov?.args).toEqual({ cameraId: 42, fieldOfView: 60 });
  });

  it("no-path: commit is dropped", () => {
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
