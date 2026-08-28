import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `Delivery` and `DelayRole` per topic, scanned out of the Uplink's own C#.
 *
 * ## Why a scan, and why it is safe to be one
 *
 * Both are properties of `ChannelDeclaration`, set at the declaration site inside
 * the Uplink's PLUGIN assembly. Nothing reaches them from here: the codegen that
 * writes `src/__generated__/` reflects over the CONTRACT assembly, which holds
 * the payload types and not the channel list, and the only other authority is a
 * running mod.
 *
 * A source scan is a fragile instrument, and this one is built so that its
 * fragility is loud rather than silent. `readWireSurface` already knows every
 * statically-declared topic from the generated slice, so the caller cross-checks:
 * a topic the generated slice names and this scan did not find FAILS. That is the
 * whole safety argument. A scanner that quietly returns nothing is the exact shape
 * this project keeps meeting (a regex with no matches reports a clean pass), and
 * the cross-check converts it into a build error naming the topic.
 *
 * ## The factory case is real
 *
 * Most declarations are plain object initialisers with a literal or a `const` in
 * `Topic`. One Uplink declares a `private static ChannelDeclaration TrueNow(string
 * topic) => new ChannelDeclaration { ... }` and calls it five times, so a scanner
 * that only understood initialisers would have found zero channels for it and
 * said nothing. Both forms are handled, and the cross-check is what would have
 * caught it either way.
 */
export interface ChannelDisposition {
  /** `lossy-latest`, `reliable-ordered`: the C# enum member, kebab-cased. */
  delivery?: string;
  /** `delayed`, `true-now`. */
  delay?: string;
}

/** `LossyLatest` -> `lossy-latest`. The enum member is the fact; this is spelling. */
function kebab(member: string): string {
  return member
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * The C# files that could declare this Uplink's channels.
 *
 * Walked up from the client package, because the layouts differ and all three are
 * real: the app's own repo keeps the plugin beside the client (`<Uplink>/*.cs`
 * with `<Uplink>/client/`), the operator's monorepo keeps it in a sibling
 * (`uplinks/<name>/mod/*.cs`), and a flat single-Uplink repo is the second shape
 * with one fewer level. Nothing here names a repo.
 */
function candidateSources(pkgDir: string): string[] {
  const files: string[] = [];
  let dir = pkgDir;
  for (let up = 0; up < 3; up++) {
    dir = resolve(dir, "..");
    for (const at of [dir, join(dir, "mod")]) {
      if (!existsSync(at)) continue;
      try {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".cs")) {
            files.push(join(at, entry.name));
          }
        }
      } catch {
        // Not a readable directory: the next candidate is the answer.
      }
    }
    if (files.length > 0) return files;
  }
  return files;
}

const CONST_STRING = /\bconst\s+string\s+(\w+)\s*=\s*"([^"]*)"/g;
const INITIALISER = /new\s+ChannelDeclaration\s*\{/g;
const FACTORY =
  /\bChannelDeclaration\s+(\w+)\s*\([^)]*\)\s*=>\s*new\s+ChannelDeclaration\s*\{/g;

/** The body of a brace-balanced block whose opening `{` is at `from`. */
function block(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(from + 1, i);
    }
  }
  return "";
}

function property(body: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*([\\w.]+|"[^"]*")`).exec(body);
  return match?.[1];
}

function enumMember(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const member = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  return kebab(member);
}

export function readChannelDispositions(
  pkgDir: string,
): Map<string, ChannelDisposition> {
  const out = new Map<string, ChannelDisposition>();
  const sources = candidateSources(pkgDir);
  if (sources.length === 0) return out;

  const consts = new Map<string, string>();
  const bodies = sources.map((file) => readFileSync(file, "utf8"));
  for (const source of bodies) {
    for (const match of source.matchAll(CONST_STRING)) {
      consts.set(match[1], match[2]);
    }
  }

  /** Factory name -> the disposition its body declares. */
  const factories = new Map<string, ChannelDisposition>();
  for (const source of bodies) {
    for (const match of source.matchAll(FACTORY)) {
      const body = block(source, match.index + match[0].length - 1);
      factories.set(match[1], {
        delivery: enumMember(property(body, "Delivery")),
        delay: enumMember(property(body, "Delay")),
      });
    }
  }

  const topicOf = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    if (raw.startsWith('"')) return raw.slice(1, -1);
    // A bare identifier: a const in this Uplink, or a factory's parameter, which
    // is not a topic at all and is handled by the factory pass below.
    return consts.get(raw) ?? consts.get(raw.slice(raw.lastIndexOf(".") + 1));
  };

  for (const source of bodies) {
    for (const match of source.matchAll(INITIALISER)) {
      const body = block(source, match.index + match[0].length - 1);
      const topic = topicOf(property(body, "Topic"));
      if (!topic) continue;
      out.set(topic, {
        delivery: enumMember(property(body, "Delivery")),
        delay: enumMember(property(body, "Delay")),
      });
    }
    /*
     * Factory call sites: `TrueNow(AvailableTopic)`, and
     * `Ground(ConfidenceTopic, absenceIsData: true)`.
     *
     * Only the FIRST argument is read, and the terminator is `,` or `)` rather
     * than `)` alone. Requiring a single argument was the first version, and the
     * cross-check caught it immediately: one Uplink passes a second argument to
     * one of its factories, so `rp1.confidence` came back with no declaration
     * found. Which is the whole point of the cross-check existing.
     */
    for (const [name, disposition] of factories) {
      const calls = new RegExp(`\\b${name}\\s*\\(\\s*([\\w."]+)\\s*[,)]`, "g");
      for (const call of source.matchAll(calls)) {
        const topic = topicOf(call[1]);
        if (topic) out.set(topic, disposition);
      }
    }
  }
  return out;
}
