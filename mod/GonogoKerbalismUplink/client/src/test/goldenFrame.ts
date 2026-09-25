import { readFileSync } from "node:fs";

/**
 * One recorded wire frame from a `golden-fixtures/*.json` vector file of this
 * Uplink's Tests project.
 *
 * The frame is held as a JSON STRING inside the vector: the C# side asserts
 * byte equality against it, and a nested object would be reformatted by the
 * repo's JSON formatter.
 *
 * `T` is the payload the CALLER expects, which nothing in the file can confirm,
 * so the one erasure that names it lives here rather than at each test. What the
 * file itself carries is checked: a vector list of `{ name, json }`, and a named
 * vector that is present.
 */
export function goldenFrame<T>(
  fixturePath: string,
  name: string,
): { topic: string; payload: T } {
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${fixturePath} does not hold a list of vectors`);
  }
  const vectors: unknown[] = parsed;
  const vector = vectors.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Reflect.get(entry, "name") === name,
  );
  if (typeof vector !== "object" || vector === null) {
    throw new Error(`fixture vector ${name} not found in ${fixturePath}`);
  }
  const json: unknown = Reflect.get(vector, "json");
  if (typeof json !== "string") {
    throw new Error(`fixture vector ${name} carries no frame string`);
  }
  return JSON.parse(json) as { topic: string; payload: T };
}
