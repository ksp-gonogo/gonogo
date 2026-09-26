import type { EncounterDirection } from "./encounter";

function rootName(
  bodies: readonly { name: string | null; referenceBody: string | null }[],
): string | null {
  return bodies.find((b) => !b.referenceBody)?.name ?? null;
}

/** The body the diagram centres on for a `frame` setting, or `null` before there is one to centre on. */
export function resolveFrame(
  bodies: readonly { name: string | null; referenceBody: string | null }[],
  setting: string,
  vesselBody: string | null,
): string | null {
  // Follow the vessel's current body, falling back to the root until it arrives.
  if (setting === "auto") return vesselBody || rootName(bodies);
  if (setting === "root") {
    if (!vesselBody) return rootName(bodies);
    let cursor: string | null = vesselBody;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const body = bodies.find((b) => b.name === cursor);
      if (!body) break;
      if (!body.referenceBody) return body.name;
      cursor = body.referenceBody;
    }
    return cursor;
  }
  // A saved "current" is the vessel's body.
  if (setting === "current") return vesselBody;
  return setting;
}

/** The status line above the diagram: what is centred, and the vessel's next SOI transition when it has one. */
export function frameCaption({
  haveBodies,
  parentName,
  encounterDirection,
  encounterBody,
}: {
  haveBodies: boolean;
  parentName: string | null;
  encounterDirection: EncounterDirection | null;
  encounterBody: string | null;
}): string {
  if (!haveBodies) return "Waiting for body data...";
  if (parentName === null) return "Pick a frame in the widget config.";
  if (encounterDirection === null || encounterBody == null) {
    return `Frame: ${parentName}`;
  }
  return `Frame: ${parentName} · next ${encounterDirection}: ${encounterBody}`;
}
