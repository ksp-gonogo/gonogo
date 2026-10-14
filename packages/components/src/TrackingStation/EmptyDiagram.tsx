import type { CSSProperties } from "react";
import type { CelestialBody } from "./useCelestialBodies";

/** No bodies orbit the frame yet; names what telemetry does report so a parent-name mismatch is visible. */
export function EmptyDiagram({
  bodies,
  parentName,
}: Readonly<{ bodies: readonly CelestialBody[]; parentName: string }>) {
  const distinctParents = Array.from(
    new Set(
      bodies
        .map((b) => b.referenceBody)
        .filter((r): r is string => typeof r === "string" && r.length > 0),
    ),
  ).sort();
  const knownCount = bodies.filter((b) => b.name).length;
  return (
    <div style={EMPTY}>
      <div>
        No bodies orbiting <b>{parentName}</b> yet.
      </div>
      <div style={HINT}>
        Telemetry reports {knownCount} {knownCount === 1 ? "body" : "bodies"}
        {distinctParents.length > 0
          ? `; parents seen: ${distinctParents.join(", ")}`
          : "; no referenceBody values yet"}
        .
      </div>
    </div>
  );
}

const EMPTY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--gap-related)",
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-empty-state)",
  textAlign: "center",
};

const HINT: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  maxWidth: "320px",
};
