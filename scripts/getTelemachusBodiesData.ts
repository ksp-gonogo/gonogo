// @ts-expect-error -- temp script
import fs from "node:fs";

const BASE_URL = "http://192.168.86.33:8085/telemachus/datalink";

async function fetchGroup(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}?${query}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const bodyCountRes = await fetchGroup("t=b.number");
  const bodyCount = Number(bodyCountRes.t);

  console.log(`Found ${bodyCount} bodies`);

  const bodies = [];

  for (let i = 0; i < bodyCount; i++) {
    // ── Batch 1: atmospheric data ─────────────────────────────
    const atmosphereData = await fetchGroup(
      `atmosphere=b.atmosphere[${i}]&maxAtmosphere=b.maxAtmosphere[${i}]`,
    );

    // ── Batch 2: structural data ──────────────────────────────
    const coreData = await fetchGroup(
      `name=b.name[${i}]&radius=b.radius[${i}]&referenceBody=b.referenceBody[${i}]`,
    );

    const name = coreData.name;
    const radius = Number(coreData.radius);
    const parent = coreData.referenceBody || null;

    const hasAtmosphere = Boolean(atmosphereData.atmosphere);
    const maxAtmosphere = hasAtmosphere
      ? Number(atmosphereData.maxAtmosphere)
      : 0;

    bodies.push({
      id: name,
      name,
      radius,
      hasAtmosphere,
      maxAtmosphere,
      parent,
    });

    console.log(`✓ ${name}`);
  }

  const output = `// AUTO-GENERATED FILE: DO NOT EDIT
// Generated from Telemachus

export const STOCK_BODIES = ${JSON.stringify(bodies, null, 2)} as const;
`;

  fs.writeFileSync("./bodies.generated.ts", output);

  console.log("Done → bodies.generated.ts");
}

main().catch(console.error);
