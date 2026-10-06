import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * How one channel is sent, as the Uplink's C# `ChannelDeclaration` sets it: its
 * `Delivery` and its `DelayRole`. Read from the C# sources by
 * {@link readChannelDispositions}, which understands both a plain declaration
 * and a factory method that returns one. When there is C# beside the client
 * and it declares no channel the generated contract names, page generation
 * fails naming it. When there is no C# to read, the page lists every channel
 * without its delivery or delay.
 *
 * @category Uplink page
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
// `=> new ChannelDeclaration {`, `=> new ChannelDeclaration() {` and the target-typed `=> new() {`.
const FACTORY =
  /\bChannelDeclaration\s+(\w+)\s*\([^)]*\)\s*=>\s*new\s*(?:ChannelDeclaration\s*)?(?:\(\s*\)\s*)?\{/g;

/** The body of a brace-balanced block whose opening `{` is at `from`. */
function block(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
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

/** Whether there is any C# for {@link readChannelDispositions} to read near `pkgDir`. */
export function channelSourcesFound(pkgDir: string): boolean {
  return candidateSources(pkgDir).length > 0;
}

/**
 * How each channel an Uplink's C# declares is sent, read from the C# sources
 * under `pkgDir`, keyed by channel id.
 *
 * @category Uplink page
 */
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
     * one of its factories, so one of its Topics came back with no declaration
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
