import { normalizeFamily } from "../../emit";
import { isValidFamily } from "../../resolve";

export { isValidFamily, normalizeFamily };

/** The literal text before the first placeholder, empty when the pattern starts with one. */
export const prefixOfFamily = (pattern: string) =>
  pattern.slice(0, pattern.indexOf("<"));

/** Whether a field path sits at or under a member of `pattern`: the pattern's segments match the path's first ones. */
export function pathIsUnderFamily(path: string, pattern: string): boolean {
  const have = path.split(".");
  const want = pattern.split(".");
  if (have.length < want.length) return false;
  return want.every((segment, index) =>
    segment.startsWith("<") && segment.endsWith(">")
      ? have[index] !== ""
      : have[index] === segment,
  );
}

/** Whether a field path is a Topic or a field of one. */
export const pathIsUnderTopic = (path: string, topic: string) =>
  path === topic || path.startsWith(`${topic}.`);
