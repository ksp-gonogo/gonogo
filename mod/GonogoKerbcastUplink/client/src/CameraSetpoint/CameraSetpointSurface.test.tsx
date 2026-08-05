import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { CameraSetpointSurface } from "./CameraSetpointSurface";

const bounds = {
  yawMin: -90,
  yawMax: 90,
  pitchMin: -45,
  pitchMax: 45,
  fovMin: 10,
  fovMax: 90,
};
const initial = { yaw: 0, pitch: 0, fov: 60 };

// jest-dom matchers aren't wired into the kerbcast test setup (see
// CameraFeed.test.tsx / FramingPreview.test.tsx), so assert presence with
// plain truthy / null / property checks rather than toBeInTheDocument etc.
describe("CameraSetpointSurface", () => {
  it("is hidden in live mode", () => {
    const { container } = render(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={initial}
        mode="live"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the three setpoint sliders in staged mode", () => {
    render(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={initial}
        mode="staged"
      />,
    );
    expect(screen.getByRole("slider", { name: /yaw/i })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /pitch/i })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /field of view/i })).toBeTruthy();
  });

  it("gates the commit in no-path mode", () => {
    render(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={initial}
        mode="no-path"
      />,
    );
    const commit = screen.getByRole("button", { name: /commit/i });
    expect((commit as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no axe violations in staged mode", async () => {
    const { container } = render(
      <CameraSetpointSurface
        cameraId={42}
        bounds={bounds}
        initial={initial}
        mode="staged"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
