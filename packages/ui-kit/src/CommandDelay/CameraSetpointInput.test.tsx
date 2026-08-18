import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { fireEvent, render, screen } from "../testing-react";
import { CameraSetpointInput } from "./CameraSetpointInput";

const bounds = {
  yawMin: -90,
  yawMax: 90,
  pitchMin: -45,
  pitchMax: 45,
  fovMin: 10,
  fovMax: 90,
};

describe("CameraSetpointInput", () => {
  it("renders three sliders (yaw, pitch, fov)", () => {
    render(
      <CameraSetpointInput
        value={{ yaw: 0, pitch: 0, fov: 60 }}
        bounds={bounds}
        onChange={() => {}}
        onCommit={() => {}}
      />,
    );
    expect(screen.getByRole("slider", { name: /yaw/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /pitch/i })).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: /fov|field of view/i }),
    ).toBeInTheDocument();
  });

  it("commits the current vector once on commit", () => {
    const onCommit = vi.fn();
    render(
      <CameraSetpointInput
        value={{ yaw: 10, pitch: -5, fov: 40 }}
        bounds={bounds}
        onChange={() => {}}
        onCommit={onCommit}
        commitLabel="Commit"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ yaw: 10, pitch: -5, fov: 40 });
  });

  it("gates the commit when gated (no-path)", () => {
    const onCommit = vi.fn();
    render(
      <CameraSetpointInput
        value={{ yaw: 0, pitch: 0, fov: 60 }}
        bounds={bounds}
        gated
        gatedReason="No signal path"
        onChange={() => {}}
        onCommit={onCommit}
        commitLabel="Commit"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CameraSetpointInput
        value={{ yaw: 0, pitch: 0, fov: 60 }}
        bounds={bounds}
        onChange={() => {}}
        onCommit={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
