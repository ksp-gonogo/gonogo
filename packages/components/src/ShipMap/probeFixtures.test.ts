import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface WirePart {
  id: string;
  parentId?: string;
  name: string;
  position: { x: number; y: number; z: number };
  bounds: { size: { x: number; y: number; z: number }; center?: { y: number } };
}

const DIR = join(__dirname, "__fixtures__", "probe");

function partsOf(file: string): WirePart[] {
  const fixture = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const emit = fixture._stream.emits.find(
    (e: { channel: string }) => e.channel === "vessel.parts",
  );
  return emit?.value.parts ?? [];
}

describe("probe vessel.parts fixtures", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

  it.each(
    files,
  )("%s stacks each part against its parent with no gap or overlap", (file) => {
    const parts = partsOf(file);
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const part of parts) {
      const parent = part.parentId ? byId.get(part.parentId) : undefined;
      if (!parent) continue;
      const centre = (p: WirePart) => p.position.y + (p.bounds.center?.y ?? 0);
      const apart = Math.abs(centre(parent) - centre(part));
      const touching = (parent.bounds.size.y + part.bounds.size.y) / 2;
      expect(apart, `${part.name} under ${parent.name}`).toBeCloseTo(
        touching,
        2,
      );
    }
  });
});
