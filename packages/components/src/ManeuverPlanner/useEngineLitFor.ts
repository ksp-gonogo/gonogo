import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { useRef } from "react";
import { type BurnInstants, engineLitFor } from "./burnFlown";

/**
 * Whether the engine now lit is the burn toward each node, keeping the answer
 * for as long as that same engine start is running. A node's planned ignition
 * is recomputed from the craft as it burns and drifts later on a long burn, so
 * a start that matched the window when the burn began would fall out of it
 * part-way through. Returns a function of the node's id, its instants and the
 * engine's start (null when not thrusting). Used by the planned-nodes rows and
 * the tile's header figure.
 */
export function useEngineLitFor(): (
  nodeId: string,
  burn: BurnInstants,
  startedUt: Value<"ut"> | null | undefined,
) => boolean {
  const attributed = useRef(new Map<string, Value<"ut">>());
  return (nodeId, burn, startedUt) => {
    if (startedUt === null || startedUt === undefined) {
      attributed.current.delete(nodeId);
      return false;
    }
    if (engineLitFor(burn, startedUt)) {
      attributed.current.set(nodeId, startedUt);
      return true;
    }
    return attributed.current.get(nodeId)?.equals(startedUt) ?? false;
  };
}
