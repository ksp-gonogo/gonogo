/** Crew names from `vessel.crew.crew`, accepting bare strings or `{ name }` objects and dropping anything else. */
export function toCrewNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: string[] = [];
  for (const entry of entries) {
    const name = crewNameOf(entry);
    if (name !== undefined) out.push(name);
  }
  return out;
}

function crewNameOf(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry.trim().length > 0 ? entry : undefined;
  }
  if (typeof entry !== "object" || entry === null) return undefined;
  const name: unknown = Reflect.get(entry, "name");
  if (typeof name === "string" && name.trim().length > 0) return name;
  return undefined;
}
