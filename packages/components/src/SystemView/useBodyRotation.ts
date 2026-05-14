import { useDataValue } from "@gonogo/core";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * Subscribe to a single body's `b.rotationAngle` and `b.rotates` by name.
 *
 * Distinct from `useCelestialBodies`: that hook fans out static body
 * metadata across every body (~17 in stock Kerbol) and bumps on every
 * sample. Rotation angle ticks at the WS frame rate (~4 Hz × N bodies),
 * which would force a full SystemView/TargetPicker re-render every
 * 250/N ms. Per-body subscription instead — one stream for whichever
 * body the OrbitView is rendering.
 *
 * Returns `null` for either field while the underlying body index hasn't
 * resolved yet (the bodies fan-out hasn't reached the row whose name
 * matches `bodyName`) or while the first sample for the key hasn't
 * landed.
 */
export function useBodyRotation(bodyName: string | null | undefined): {
  angleDeg: number | null;
  rotates: boolean | null;
} {
  const bodies = useCelestialBodies();
  const body = bodyName
    ? (bodies.find((b) => b.name === bodyName) ?? null)
    : null;
  // useDataValue is called unconditionally with a sentinel key when we don't
  // have a body index yet — keeps the hook order stable across renders. The
  // sentinel will never resolve to a real value, so the readback stays
  // `undefined`.
  const angleKey =
    body !== null ? (`b.rotationAngle[${body.index}]` as const) : null;
  const rotatesKey =
    body !== null ? (`b.rotates[${body.index}]` as const) : null;
  const angle = useDataValue("data", angleKey ?? "b.rotationAngle[-1]");
  const rotates = useDataValue("data", rotatesKey ?? "b.rotates[-1]");
  return {
    angleDeg:
      typeof angle === "number" && Number.isFinite(angle) ? angle : null,
    rotates: typeof rotates === "boolean" ? rotates : null,
  };
}
