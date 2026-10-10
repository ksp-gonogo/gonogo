import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The `include:` legs of one ci.yml job's matrix, as their raw `key: value` lines. */
function legs(job: string): Record<string, string>[] {
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const start = ci.indexOf(`\n  ${job}:\n`);
  if (start < 0) throw new Error(`ci.yml has no ${job} job`);
  const rest = ci.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = end < 0 ? rest : rest.slice(0, end + 1);
  const out: Record<string, string>[] = [];
  for (const m of body.matchAll(
    /^ {10}- leg: (.+)$((?:\n {12}[\w-]+: .+)*)/gm,
  )) {
    const leg: Record<string, string> = { leg: m[1].trim() };
    for (const line of m[2].split("\n").filter(Boolean)) {
      const [k, ...v] = line.trim().split(": ");
      leg[k] = v.join(": ").replace(/^"|"$/g, "");
    }
    out.push(leg);
  }
  return out;
}

/** Package short names (manifest name without the scope) that have a test script. */
function testedPackages(): string[] {
  const dirs = [
    ...readdirSync(join(ROOT, "packages")).map((d) =>
      join(ROOT, "packages", d),
    ),
  ];
  return dirs
    .flatMap((d) => {
      try {
        const m = JSON.parse(readFileSync(join(d, "package.json"), "utf8"));
        return m.scripts?.test
          ? [String(m.name).replace("@ksp-gonogo/", "")]
          : [];
      } catch {
        return [];
      }
    })
    .sort();
}

describe("the unit-test and act-warnings legs cover every package once", () => {
  const packages = testedPackages();

  it("reads the legs and the packages at all, before comparing them", () => {
    expect(packages).toContain("core");
    expect(packages).toContain("components");
    expect(legs("unit-test").length).toBeGreaterThan(3);
    expect(legs("act-warnings").length).toBeGreaterThan(3);
  });

  it("gives each package to exactly one unit-test leg, the components legs sharding its files", () => {
    const named = new Set(["components", "app", "core"]);
    const positive = legs("unit-test")
      .map((l) => l["turbo-scope"])
      .filter((s) => !s.includes("!"))
      .map((s) => s.replace("--filter=@ksp-gonogo/", ""));
    const perPackage = (name: string) =>
      positive.filter((p) => p === name).length;
    expect(perPackage("components")).toBe(4);
    for (const n of ["app", "core"]) expect(perPackage(n), n).toBe(1);
    const rest = legs("unit-test").find((l) => l.leg === "rest");
    const excluded = [
      ...(rest?.["turbo-scope"] ?? "").matchAll(/!@ksp-gonogo\/([\w-]+)/g),
    ].map((m) => m[1]);
    expect(excluded.sort()).toEqual([...named].sort());
    const shards = legs("unit-test").flatMap((l) => (l.shard ? [l.shard] : []));
    expect(shards.sort()).toEqual(["1/4", "2/4", "3/4", "4/4"]);
  });

  it("gives each package to exactly one act-warnings leg", () => {
    const scopes = legs("act-warnings").map((l) => l.scope);
    const shards = scopes
      .filter((s) => s.includes("--shard"))
      .map((s) => s.split("--shard ")[1]);
    expect(shards.sort()).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    const filtered = scopes
      .filter((s) => !s.includes("--shard") && s.startsWith("--filter "))
      .map((s) => s.replace("--filter ", ""));
    const except =
      scopes
        .find((s) => s.startsWith("--except "))
        ?.replace("--except ", "")
        .split(",") ?? [];
    expect(except.sort()).toEqual(["app", "components", "core"]);
    expect(filtered.sort()).toEqual(["app", "core"]);
    for (const name of [...filtered, ...except])
      expect(packages).toContain(name);
  });
});
