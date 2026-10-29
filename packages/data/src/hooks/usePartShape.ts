import { useStream } from "@ksp-gonogo/sitrep-client";
import type { PartShape, WireOf } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";

/** The namespace each kind of part's shape is published under. */
export const PART_SHAPE_TOPIC_PREFIX = "parts.shape.";

/** The topic carrying the shape a part row names in its `shape` field. */
export function partShapeTopic(key: string): string {
  return `${PART_SHAPE_TOPIC_PREFIX}${key}`;
}

/** One mesh of a part's shape, unpacked into arrays a renderer can index. */
export interface DecodedPartShapeMesh {
  /** The mesh's name within its part, as a part row's `shapePoses[].mesh` names it. */
  key: string;
  /** Whether the part as built draws this mesh. */
  shown: boolean;
  /** Points in the part's own frame, metres, as x, y, z triples. */
  positions: Float32Array;
  /** Three indices into the points per triangle. */
  indices: Uint16Array;
  /** How many triangles the mesh has in the game, before reduction. */
  sourceTriangles: number;
}

/** A part's shape with every mesh unpacked. */
export interface DecodedPartShape {
  name: string;
  variant: string | null;
  meshes: DecodedPartShapeMesh[];
}

function bytesOf(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function uint16sOf(base64: string): Uint16Array {
  const bytes = bytesOf(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint16Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

/**
 * Unpacks a `parts.shape.<key>` payload, as the wire carries it with bare
 * numbers: each point's three 16-bit values
 * placed in the mesh's box, and each triangle's three 16-bit indices. A mesh
 * whose indices reach past its points is left out.
 */
export function decodePartShape(wire: WireOf<PartShape>): DecodedPartShape {
  const meshes: DecodedPartShapeMesh[] = [];
  for (const mesh of wire.meshes) {
    const packed = uint16sOf(mesh.positions);
    const indices = uint16sOf(mesh.indices);
    const lo = [mesh.min.x, mesh.min.y, mesh.min.z];
    const hi = [mesh.max.x, mesh.max.y, mesh.max.z];
    const positions = new Float32Array(packed.length - (packed.length % 3));
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      positions[i] = lo[axis] + (packed[i] / 65535) * (hi[axis] - lo[axis]);
    }
    const points = positions.length / 3;
    if (indices.length % 3 !== 0 || indices.some((v) => v >= points)) continue;
    meshes.push({
      key: mesh.key,
      shown: mesh.shown,
      positions,
      indices,
      sourceTriangles: mesh.sourceTriangles,
    });
  }
  return { name: wire.name, variant: wire.variant ?? null, meshes };
}

/*
 * One unpacked shape per key, shared by every part of that kind and every
 * widget drawing one, and unpacked again only if a different payload arrives.
 */
const decoded = new Map<
  string,
  { wire: WireOf<PartShape>; shape: DecodedPartShape }
>();

/** The unpacked shape for `key`, unpacking `wire` only when it is not the payload last unpacked for that key. */
export function decodePartShapeOnce(
  key: string,
  wire: WireOf<PartShape>,
): DecodedPartShape {
  const kept = decoded.get(key);
  if (kept && kept.wire === wire) return kept.shape;
  const shape = decodePartShape(wire);
  decoded.set(key, { wire, shape });
  return shape;
}

/**
 * The 3D shape of one kind of part, from `parts.shape.<key>`, unpacked once
 * per key. `key` is a part row's `shape`. Undefined until the mod has sent it.
 *
 * Opening it is what makes the mod read the part's model, once per kind of
 * part for the whole game. A shape is the same for every craft and reaches
 * every command centre at once.
 */
export function usePartShape(key: string): DecodedPartShape | undefined {
  const reading = useStream<WireOf<PartShape>>(partShapeTopic(key));
  const raw =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return useMemo(
    () => (raw ? decodePartShapeOnce(key, raw) : undefined),
    [key, raw],
  );
}
