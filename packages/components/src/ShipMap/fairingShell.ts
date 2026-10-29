import type { TopologyPart } from "@ksp-gonogo/core";
import type { DecodedPartShape } from "@ksp-gonogo/data";

type Vec3 = { x: number; y: number; z: number };

/**
 * A procedural fairing's shell as the part row carries it: rings stacked
 * along `axis` from `pivot`, both in the part's own frame, joined by straight
 * panels. Empty `rings` means no shell stands: never built, or jettisoned.
 */
export type FairingProfile = NonNullable<TopologyPart["fairing"]>;

function unit(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function basisOf(axisIn: Vec3) {
  const axis = unit(axisIn);
  const seed =
    Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const across = unit(cross(axis, seed));
  const toward = cross(axis, across);
  return { axis, across, toward };
}

/**
 * The near half of each ring where two panels of the shell meet, between the
 * bottom ring and the nose, as SVG path data in metres in the frame `frame`
 * carries part-local points into (x across, y up, z toward the viewer).
 */
export function fairingJoins(
  profile: FairingProfile,
  frame: readonly number[],
  steps = 48,
): string {
  const { axis, across, toward } = basisOf(profile.axis);
  const p = profile.pivot;
  const carry = (v: Vec3) => [
    frame[0] * v.x + frame[1] * v.y + frame[2] * v.z + frame[3],
    frame[4] * v.x + frame[5] * v.y + frame[6] * v.z + frame[7],
    frame[8] * v.x + frame[9] * v.y + frame[10] * v.z + frame[11],
  ];
  const towardViewer = (v: Vec3) =>
    frame[8] * v.x + frame[9] * v.y + frame[10] * v.z;
  let d = "";
  for (let i = 1; i + 1 < profile.rings.length; i++) {
    const { h, r } = profile.rings[i];
    if (r <= 1e-6) continue;
    let open = false;
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const radial = {
        x: across.x * Math.cos(a) + toward.x * Math.sin(a),
        y: across.y * Math.cos(a) + toward.y * Math.sin(a),
        z: across.z * Math.cos(a) + toward.z * Math.sin(a),
      };
      if (towardViewer(radial) < 0) {
        open = false;
        continue;
      }
      const [x, y] = carry({
        x: p.x + axis.x * h + radial.x * r,
        y: p.y + axis.y * h + radial.y * r,
        z: p.z + axis.z * h + radial.z * r,
      });
      d += `${open ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`;
      open = true;
    }
  }
  return d;
}

/**
 * The shell of `profile` as a closed mesh in the part's own frame, `sides`
 * panels around: one ring of points per section, a point where a ring has no
 * radius, and a flat disc closing the bottom (and the top when it is open),
 * so its far side is never drawn. Null when no shell stands.
 */
export function fairingShellShape(
  profile: FairingProfile,
  sides = 32,
): DecodedPartShape | null {
  const kept = shells.get(profile);
  if (kept !== undefined) return kept;
  const built = buildShell(profile, sides);
  shells.set(profile, built);
  return built;
}

/* One shell per profile object, so a part drawn again from the same row reuses its mesh and the drawing cache keyed on it. */
const shells = new WeakMap<FairingProfile, DecodedPartShape | null>();

function buildShell(
  profile: FairingProfile,
  sides: number,
): DecodedPartShape | null {
  const sections = profile.rings;
  if (sections.length < 2) return null;
  const { axis, across, toward } = basisOf(profile.axis);
  const positions: number[] = [];
  const at = (h: number, r: number, k: number) => {
    const a = (k / sides) * Math.PI * 2;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    positions.push(
      profile.pivot.x + axis.x * h + across.x * c + toward.x * s,
      profile.pivot.y + axis.y * h + across.y * c + toward.y * s,
      profile.pivot.z + axis.z * h + across.z * c + toward.z * s,
    );
    return positions.length / 3 - 1;
  };
  const rings = sections.map((sec) => {
    const ring: number[] = [];
    for (let k = 0; k < sides; k++)
      ring.push(at(sec.h, sec.r, sec.r > 1e-6 ? k : 0));
    return ring;
  });
  const indices: number[] = [];
  /* Wound as a part's shape is, so the cross product of a face's first two edges points out of the shell. */
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, b, d, c);
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const lo = rings[i];
    const hi = rings[i + 1];
    for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      quad(lo[k], lo[n], hi[k], hi[n]);
    }
  }
  const disc = (sec: { h: number; r: number }, ring: number[], up: boolean) => {
    if (sec.r <= 1e-6) return;
    const middle = at(sec.h, 0, 0);
    for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      if (up) indices.push(middle, ring[k], ring[n]);
      else indices.push(middle, ring[n], ring[k]);
    }
  };
  disc(sections[0], rings[0], false);
  disc(sections[sections.length - 1], rings[rings.length - 1], true);
  return {
    name: "fairing-shell",
    variant: null,
    meshes: [
      {
        key: "shell",
        shown: true,
        positions: new Float32Array(positions),
        indices: new Uint16Array(indices),
        sourceTriangles: indices.length / 3,
      },
    ],
  };
}

/**
 * The box a fairing takes in the part's own frame: the meshes its shape draws
 * now (`shown` as its poses or its shape say) and its shell's rings. Null when
 * neither gives a point, so the part's own box stands.
 */
export function fairingBounds(
  profile: FairingProfile,
  shape: DecodedPartShape | undefined,
  poses: TopologyPart["shapePoses"],
): { size: Vec3; center: Vec3 } | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const take = (
    x: number,
    y: number,
    z: number,
    spread: number[] = [0, 0, 0],
  ) => {
    const at = [x, y, z];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], at[a] - spread[a]);
      hi[a] = Math.max(hi[a], at[a] + spread[a]);
    }
  };
  const byMesh = new Map(poses?.map((p) => [p.mesh, p]));
  for (const mesh of shape?.meshes ?? []) {
    const pose = byMesh.get(mesh.key);
    if (!(pose ? pose.shown : mesh.shown)) continue;
    const m =
      pose?.transform && pose.transform.length === 12 ? pose.transform : null;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      if (m) {
        take(
          m[0] * p[i] + m[1] * p[i + 1] + m[2] * p[i + 2] + m[3],
          m[4] * p[i] + m[5] * p[i + 1] + m[6] * p[i + 2] + m[7],
          m[8] * p[i] + m[9] * p[i + 1] + m[10] * p[i + 2] + m[11],
        );
      } else {
        take(p[i], p[i + 1], p[i + 2]);
      }
    }
  }
  const axis = unit(profile.axis);
  /* A ring of radius r about an axis reaches r times the sine of the axis's angle to each coordinate. */
  const reach = [axis.x, axis.y, axis.z].map((c) =>
    Math.sqrt(Math.max(0, 1 - c * c)),
  );
  for (const { h, r } of profile.rings) {
    take(
      profile.pivot.x + axis.x * h,
      profile.pivot.y + axis.y * h,
      profile.pivot.z + axis.z * h,
      reach.map((k) => k * r),
    );
  }
  if (!(lo[0] <= hi[0])) return null;
  return {
    size: { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] },
    center: {
      x: (lo[0] + hi[0]) / 2,
      y: (lo[1] + hi[1]) / 2,
      z: (lo[2] + hi[2]) / 2,
    },
  };
}
