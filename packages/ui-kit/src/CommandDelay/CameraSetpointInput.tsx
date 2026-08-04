/**
 * CameraSetpointInput: the grouped yaw/pitch/fov vector input for delayed
 * camera control. Three `JogWheel`s (the pan pair, Yaw + Pitch, as horizontal
 * scrubbers, and FOV as a vertical one) inside the existing `CommandGroup`
 * commit container, so the whole vector dispatches as ONE delayed command on
 * an explicit commit (never on a child's own change). Vanilla-safe: props only,
 * no gonogo data hooks. The `gated`/`gatedReason`/`commitLabel` pass straight
 * through to `CommandGroup`, whose own gating disables the commit under
 * `no-path`, so this component does not re-implement it.
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { JogWheel } from "../JogWheel";
import { writeQuantity } from "../units";
import { CommandGroup } from "./CommandGroup";

export type CameraSetpoint = { yaw: number; pitch: number; fov: number };
export type CameraSetpointBounds = {
  yawMin: number;
  yawMax: number;
  pitchMin: number;
  pitchMax: number;
  fovMin: number;
  fovMax: number;
};

export interface CameraSetpointInputProps {
  value: CameraSetpoint;
  bounds: CameraSetpointBounds;
  onChange: (next: CameraSetpoint) => void;
  onCommit: (v: CameraSetpoint) => void;
  /** `no-path` → disable + error-tone the commit (forwarded to CommandGroup). */
  gated?: boolean;
  gatedReason?: string;
  /** Per-wheel increment. Default 1 (degree). */
  step?: number;
  /** Commit button label. Default "Commit". */
  commitLabel?: string;
}

const formatDegrees = (v: number): string =>
  writeQuantity(value("°", v), { decimals: 0 });

export function CameraSetpointInput({
  value,
  bounds,
  onChange,
  onCommit,
  gated,
  gatedReason,
  step = 1,
  commitLabel,
}: CameraSetpointInputProps): JSX.Element {
  return (
    <CommandGroup
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      gated={gated}
      gatedReason={gatedReason}
      commitLabel={commitLabel}
    >
      <JogWheel
        ariaLabel="Yaw"
        orientation="horizontal"
        value={value.yaw}
        min={bounds.yawMin}
        max={bounds.yawMax}
        step={step}
        format={formatDegrees}
        onChange={(yaw) => onChange({ ...value, yaw })}
      />
      <JogWheel
        ariaLabel="Pitch"
        orientation="horizontal"
        value={value.pitch}
        min={bounds.pitchMin}
        max={bounds.pitchMax}
        step={step}
        format={formatDegrees}
        onChange={(pitch) => onChange({ ...value, pitch })}
      />
      <JogWheel
        ariaLabel="Field of view"
        orientation="vertical"
        value={value.fov}
        min={bounds.fovMin}
        max={bounds.fovMax}
        step={step}
        format={formatDegrees}
        onChange={(fov) => onChange({ ...value, fov })}
      />
    </CommandGroup>
  );
}
