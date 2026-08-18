import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { FramingPreview } from "./FramingPreview";

const bounds = {
  yawMin: -90,
  yawMax: 90,
  pitchMin: -45,
  pitchMax: 45,
  fovMin: 10,
  fovMax: 90,
};

describe("FramingPreview", () => {
  it("renders the fixed feed frame and the target polygon", () => {
    const { container } = render(
      <FramingPreview
        setpoint={{ yaw: 20, pitch: 0, fov: 40 }}
        bounds={bounds}
        width={200}
        height={120}
      />,
    );
    // fixed frame + target quad + centroid all present. jest-dom matchers
    // (toBeInTheDocument) aren't wired into the kerbcast test setup (see
    // CameraFeed.test.tsx), so assert presence with a plain null check.
    expect(container.querySelector('[data-role="feed-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-role="target-quad"]')).not.toBeNull();
    expect(
      container.querySelector('[data-role="target-centroid"]'),
    ).not.toBeNull();
  });
});
