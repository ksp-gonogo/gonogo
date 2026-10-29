import type { TopologyPart } from "@ksp-gonogo/core";
import { type DecodedPartShape, usePartShape } from "@ksp-gonogo/data";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Opens one kind of part's shape and hands it up once it has arrived. */
function PartShapeSource({
  shapeKey,
  onShape,
}: {
  shapeKey: string;
  onShape: (key: string, shape: DecodedPartShape) => void;
}) {
  const shape = usePartShape(shapeKey);
  useEffect(() => {
    if (shape) onShape(shapeKey, shape);
  }, [shapeKey, shape, onShape]);
  return null;
}

/**
 * The 3D shape of every kind of part in `parts`, by the key a part row names
 * in its `shape`, one subscription per kind however many parts share it. A
 * kind whose shape has not arrived is missing from `shapes`, as is a part with
 * no shape key. `sources` must be rendered for the shapes to be opened.
 */
export function usePartShapes(parts: readonly TopologyPart[] | undefined): {
  shapes: ReadonlyMap<string, DecodedPartShape>;
  sources: ReactNode;
} {
  const keys = useMemo(
    () =>
      [
        ...new Set(parts?.flatMap((p) => (p.shape ? [p.shape] : [])) ?? []),
      ].sort(),
    [parts],
  );
  const [shapes, setShapes] = useState<ReadonlyMap<string, DecodedPartShape>>(
    () => new Map(),
  );
  const onShape = useCallback((key: string, shape: DecodedPartShape) => {
    setShapes((held) =>
      held.get(key) === shape ? held : new Map(held).set(key, shape),
    );
  }, []);
  const sources = keys.map((key) => (
    <PartShapeSource key={key} shapeKey={key} onShape={onShape} />
  ));
  return { shapes, sources };
}
