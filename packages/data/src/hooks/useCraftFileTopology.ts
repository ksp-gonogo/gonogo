import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  type CraftFileParts,
  type WireOf,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import type { TrackedVesselTopology } from "./useTrackedVesselTopology";
import {
  buildResourcesByFlightId,
  deriveTopologyFromVesselParts,
} from "./vesselPartsAdapter";

/**
 * One craft file's name as a single topic segment: every byte outside
 * `A-Z a-z 0-9 _ -` is written as `%` and two uppercase hexadecimal digits of
 * its UTF-8 encoding, the escaping the mod writes, so a dot or a space in a
 * file name cannot split the topic.
 */
export function craftFileSegment(file: string): string {
  return Array.from(new TextEncoder().encode(file), (byte) =>
    /[A-Za-z0-9_-]/.test(String.fromCharCode(byte))
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");
}

/** The topic carrying the part tree of `file` in `facility` (`VAB` or `SPH`). */
export function craftFileTopic(facility: string, file: string): string {
  return `spaceCenter.craft.${facility}.${craftFileSegment(file)}.parts`;
}

/**
 * The part tree of one saved craft file, from
 * `spaceCenter.craft.<facility>.<file>.parts`. Undefined until the mod has sent
 * it. The facility is part of the key because a VAB file and an SPH file can
 * share a name.
 *
 * Opening it is what makes the mod read the file, so mount it only for a craft
 * the operator is looking at. A design on the ground reaches every command
 * centre at once.
 */
export function useCraftFileTopology(
  facility: string,
  file: string,
): TrackedVesselTopology | undefined {
  const segment = craftFileSegment(file);
  const reading = useStream<WireOf<CraftFileParts>>(
    `spaceCenter.craft.${facility}.${segment}.parts`,
  );
  const raw =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return useMemo(() => {
    if (!raw) return undefined;
    // A per-craft topic arrives with bare numbers; the wrap mutates, so it gets a copy the store does not hold.
    const wire = wrapTypePayload<CraftFileParts>(
      "CraftFileParts",
      structuredClone(raw),
    );
    return {
      topology: deriveTopologyFromVesselParts(wire),
      resourcesByFlightId: buildResourcesByFlightId(wire),
    };
  }, [raw]);
}
