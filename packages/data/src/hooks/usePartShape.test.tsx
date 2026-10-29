import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  decodePartShape,
  decodePartShapeOnce,
  partShapeTopic,
  usePartShape,
} from "./usePartShape";

/** Little-endian 16-bit values as the base64 the mod writes. */
function packed(values: number[]): string {
  let text = "";
  for (const v of values) text += String.fromCharCode(v & 0xff, v >> 8);
  return btoa(text);
}

/* A unit square standing in x and y at z = 0.25, as two triangles, in a box from -0.5 to 0.5 on x and y. */
const WIRE = {
  name: "liquidEngine2",
  variant: null,
  meshes: [
    {
      key: "obj_gimbal/engine",
      shown: true,
      min: { x: -0.5, y: -0.5, z: 0.25 },
      max: { x: 0.5, y: 0.5, z: 0.25 },
      positions: packed([0, 0, 0, 65535, 0, 0, 65535, 65535, 0, 0, 65535, 0]),
      indices: packed([0, 1, 2, 0, 2, 3]),
      sourceTriangles: 840,
    },
    {
      key: "fairing",
      shown: false,
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
      positions: packed([0, 0, 0, 65535, 65535, 65535]),
      indices: packed([0, 1, 2]),
      sourceTriangles: 480,
    },
  ],
};

describe("decodePartShape", () => {
  it("places each packed point in its mesh's box and reads the triangles", () => {
    const shape = decodePartShape(WIRE);

    expect(shape.name).toBe("liquidEngine2");
    expect(shape.variant).toBeNull();
    const [engine] = shape.meshes;
    expect(engine.key).toBe("obj_gimbal/engine");
    expect(engine.shown).toBe(true);
    expect(Array.from(engine.positions)).toEqual([
      -0.5, -0.5, 0.25, 0.5, -0.5, 0.25, 0.5, 0.5, 0.25, -0.5, 0.5, 0.25,
    ]);
    expect(Array.from(engine.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(engine.sourceTriangles).toBe(840);
  });

  it("leaves out a mesh whose triangles name a point it does not have", () => {
    expect(decodePartShape(WIRE).meshes.map((m) => m.key)).toEqual([
      "obj_gimbal/engine",
    ]);
  });

  it("unpacks a key's payload once and again only for a different payload", () => {
    const first = decodePartShapeOnce("liquidEngine2", WIRE);

    expect(decodePartShapeOnce("liquidEngine2", WIRE)).toBe(first);
    expect(decodePartShapeOnce("liquidEngine2", { ...WIRE })).not.toBe(first);
  });
});

function ShapeProbe({ shapeKey }: { shapeKey: string }) {
  const shape = usePartShape(shapeKey);
  if (!shape) return <div>shape:none</div>;
  return (
    <div>{`meshes:${shape.meshes.length} triangles:${shape.meshes[0].indices.length / 3}`}</div>
  );
}

describe("usePartShape", () => {
  it("opens the kind of part's own topic and unpacks what arrives", async () => {
    const t = new StubTransport();
    render(
      <TelemetryProvider client={new TelemetryClient(t)}>
        <ShapeProbe shapeKey="liquidEngine2%2Ev2.Shroud" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("shape:none")).toBeTruthy();
    expect(t.isSubscribed(partShapeTopic("liquidEngine2%2Ev2.Shroud"))).toBe(
      true,
    );

    act(() => {
      t.emit("parts.shape.liquidEngine2%2Ev2.Shroud", WIRE);
    });
    await waitFor(() =>
      expect(screen.getByText("meshes:1 triangles:2")).toBeTruthy(),
    );
  });
});
