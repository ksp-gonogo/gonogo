/**
 * `uplink-tools publish`: put a released client where its declared `client.url`
 * is served from.
 *
 * The copy is the small part. What it guarantees is that the bundle lives
 * somewhere no working tree owns, so the URL the plugin carries stays true after
 * the repository is moved or deleted, and that a published version is never
 * rewritten: an app already running it fetches that URL.
 *
 * A jsDelivr `/gh/<owner>/<repo>@<ref>/<path>` URL serves a ref of the
 * repository, which is how releases live on a branch and never touch the default
 * one. The file lands at `<path>` inside a checkout of that ref. A URL with no
 * `@<ref>` is served from the default branch, the one tree release bytes must
 * stay out of, so it is refused.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";

export const PUBLISH_USAGE = `uplink-tools publish [options]

  Copy the released client, its bundle and its gonogo-uplink.json, and the
  spec sheet docs/spec.json when the client has one, to where
  uplink.json's client.url is served from, and say the links. Run it after
  release. A published version is never overwritten: a bundle that differs from
  the one already there is a new version, with its own URL.

  For a jsDelivr URL (https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>)
  the files go into a checkout of <ref>. By default that is .releases/ in the
  Uplink, a worktree of <ref> that publish creates, from the remote's branch or
  as a new orphan branch when there is none.

  --to <dir>        the root of a checkout of the ref the URL names, or, for
                    any other URL, the folder that is served at its root
  --from <dir>      the built client (default: client/dist/<id>/ in the Uplink)
  --push            commit what changed and push it to the ref, then check the
                    remote holds the commit. Needs a git remote named origin
  --purge           ask jsDelivr to drop its cached copy of each URL it published
  --tag <tag>       refuse unless the tag is <id>-v<version>, as release does
  --uplink <dir>    the Uplink's directory, the one holding uplink.json
                    (default: found by walking up from the current directory)`;

/**
 * Why a release tag does not name this Uplink at this version, or nothing.
 * A tag is `<id>-v<version>`.
 */
export function tagFault(
  tag: string,
  id: string,
  version: string,
): string | undefined {
  const match = /^(.+)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match) {
    return `${tag} is not a release tag. A release tag is <uplink id>-v<semver>, such as ${id}-v${version || "0.0.1"}.`;
  }
  if (match[1] !== id) {
    return `${tag} names the Uplink ${match[1]}, and this one is ${id}.`;
  }
  if (match[2] !== version) {
    return `${tag} is for version ${match[2]}, and client/package.json says ${version}. Tag the commit whose version it is, or move the version first.`;
  }
  return undefined;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const field = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null
    ? Reflect.get(from, key)
    : undefined;

interface GitResult {
  ok: boolean;
  out: string;
}

const git = (dir: string, ...args: string[]): GitResult => {
  const run = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return {
    ok: run.status === 0,
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim(),
  };
};

/**
 * `<root>/.releases`, a worktree of `ref`: the remote's branch when it has one,
 * otherwise a new orphan branch, so the first release needs no setup.
 */
function releasesCheckout(uplinkDir: string, ref: string): string {
  const dir = join(uplinkDir, ".releases");
  if (existsSync(dir)) return dir;
  const top = git(uplinkDir, "rev-parse", "--show-toplevel");
  if (!top.ok) {
    throw new Error(
      `${uplinkDir} is not in a git repository, so there is no ${ref} branch to publish into. ` +
        "Run git init and add the remote, or name a folder with --to.",
    );
  }
  const remote = git(
    uplinkDir,
    "ls-remote",
    "--exit-code",
    "--heads",
    "origin",
    ref,
  );
  if (remote.ok) {
    const fetched = git(
      uplinkDir,
      "fetch",
      "--no-tags",
      "origin",
      `${ref}:${ref}`,
    );
    if (!fetched.ok && !git(uplinkDir, "rev-parse", "--verify", ref).ok) {
      throw new Error(`could not fetch ${ref} from origin: ${fetched.out}`);
    }
    const added = git(uplinkDir, "worktree", "add", dir, ref);
    if (!added.ok) throw new Error(`could not check out ${ref}: ${added.out}`);
  } else {
    const added = git(uplinkDir, "worktree", "add", "--orphan", "-b", ref, dir);
    if (!added.ok) throw new Error(`could not create ${ref}: ${added.out}`);
  }
  return dir;
}

export interface PublishPlan {
  id: string;
  url: string;
  /** Where the file lands under the root of the served tree. */
  treePath: string;
  /** The git ref a jsDelivr URL names. */
  ref?: string;
  owner?: string;
  repo?: string;
}

/** Where a declared client URL is served from, or why it cannot be published. */
export function planPublish(id: string, url: string): PublishPlan {
  if (!url) {
    throw new Error(
      `${id}: uplink.json declares no client.url, so there is no release URL to publish under and nothing would fetch what this copied.`,
    );
  }
  const declaredPath = (
    URL.canParse(url) ? new URL(url).pathname : url
  ).replace(/^\/+/, "");
  const onJsdelivr =
    URL.canParse(url) && new URL(url).host === "cdn.jsdelivr.net";
  if (!onJsdelivr) return { id, url, treePath: declaredPath };
  const match = /^gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/.exec(declaredPath);
  if (!match) {
    throw new Error(
      `${id}: ${url} names no @<ref>. jsDelivr serves a ref-less /gh/ URL from the default branch, ` +
        "where release bytes must never be committed. Name the releases branch: " +
        "/gh/<owner>/<repo>@releases/<path>.",
    );
  }
  return {
    id,
    url,
    owner: match[1],
    repo: match[2],
    ref: match[3],
    treePath: match[4],
  };
}

/** Why `root` is not a checkout of `ref`, or nothing. */
function checkoutFault(root: string, ref: string): string | undefined {
  const top = git(root, "rev-parse", "--show-toplevel");
  const isRoot =
    top.ok && existsSync(root) && realpathSync(top.out) === realpathSync(root);
  const branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD").out;
  const tags = git(root, "tag", "--points-at", "HEAD").out.split("\n");
  if (isRoot && (branch === ref || tags.includes(ref))) return undefined;
  return (
    `the URL is served from ref ${ref}, but ${root} is ` +
    (isRoot
      ? `a checkout of ${branch || tags.filter(Boolean).join(", ") || "a detached HEAD"}`
      : "not the root of a git checkout") +
    `. Files committed there are never fetched by anyone. Pass the root of a checkout of ${ref}: git worktree add <dir> ${ref}`
  );
}

export interface PublishResult {
  bundleUrl: string;
  sidecarUrl: string;
  target: string;
  /** Where the spec sheet is served, when one was published beside the bundle. */
  specUrl?: string;
  /** Whether anything on disk changed. */
  changed: boolean;
}

/** The spec sheet's file name in a release folder, which a viewer fetches beside the sidecar. */
export const RELEASED_SPEC_FILE = "spec.json";

/**
 * Copies the client into the served tree, and the Uplink's spec sheet beside it
 * when `specSheet` names a file that exists. Never overwrites a different
 * published file.
 */
export function copyRelease(
  plan: PublishPlan,
  from: string,
  root: string,
  specSheet?: string,
): PublishResult {
  const bundleName = `${plan.id}.client.js`;
  const copies: [string, string][] = [
    [bundleName, basename(plan.treePath)],
    ["gonogo-uplink.json", "gonogo-uplink.json"],
  ];
  const withSpec = specSheet !== undefined && existsSync(specSheet);
  const sources = new Map<string, string>(
    copies.map(([file, as]) => [as, join(from, file)]),
  );
  if (withSpec) {
    copies.push([RELEASED_SPEC_FILE, RELEASED_SPEC_FILE]);
    sources.set(RELEASED_SPEC_FILE, specSheet);
  }
  for (const [file] of copies) {
    if (file !== RELEASED_SPEC_FILE && !existsSync(join(from, file))) {
      throw new Error(
        `${join(from, file)} does not exist. Build it first: uplink-tools release. The loader derives ` +
          "the sidecar's URL from the bundle's own, so both are published together or the fetch half-succeeds.",
      );
    }
  }
  const target = resolve(root, dirname(plan.treePath));
  let changed = false;
  for (const [file, as] of copies) {
    const dest = join(target, as);
    const bytes = readFileSync(sources.get(as) as string);
    if (existsSync(dest)) {
      if (!readFileSync(dest).equals(bytes)) {
        throw new Error(
          `${dest} is already published with different bytes. A published client version is never ` +
            "overwritten: an app running it fetches that URL, and new bytes behind it would change what a " +
            "user runs without anything saying so. Cut a new client version, with its own URL in " +
            "uplink.json, in a directory of its own so its sidecar is its own too.",
        );
      }
    } else changed = true;
  }
  mkdirSync(target, { recursive: true });
  for (const [, as] of copies) {
    copyFileSync(sources.get(as) as string, join(target, as));
  }
  return {
    bundleUrl: plan.url,
    sidecarUrl: plan.url.replace(/[^/]+$/, "gonogo-uplink.json"),
    specUrl: withSpec
      ? plan.url.replace(/[^/]+$/, RELEASED_SPEC_FILE)
      : undefined,
    target,
    changed,
  };
}

/**
 * Commits what changed in `root` and pushes it to `ref`, then checks the remote holds the commit.
 * With nothing new to commit it still pushes a commit an earlier run made and could not send,
 * and says "already on" only when the remote holds the local head.
 */
export function pushRelease(root: string, ref: string, message: string): void {
  git(root, "add", "-A");
  if (git(root, "diff", "--cached", "--quiet").ok) {
    const head = git(root, "rev-parse", "--verify", "HEAD");
    const onRemote = git(
      root,
      "ls-remote",
      "origin",
      `refs/heads/${ref}`,
    ).out.split("\t")[0];
    if (!head.ok || head.out === onRemote) {
      console.log(`${message}: already on ${ref}, byte for byte.`);
      return;
    }
    console.log(
      `${message}: committed here but not on origin/${ref}, so pushing the earlier commit.`,
    );
  } else {
    // A runner has no identity of its own; an author's configured one wins.
    const identity = git(root, "config", "user.email").out
      ? []
      : [
          "-c",
          "user.name=uplink-tools",
          "-c",
          "user.email=uplink-tools@users.noreply.github.com",
        ];
    const committed = git(root, ...identity, "commit", "-q", "-m", message);
    if (!committed.ok) {
      throw new Error(`could not commit the release: ${committed.out}`);
    }
  }
  const pushed = git(root, "push", "origin", ref);
  if (!pushed.ok) {
    throw new Error(
      `could not push ${ref}: ${pushed.out}\nThe release is committed in ${root}; run the same command again once the remote is reachable, and it pushes that commit.`,
    );
  }
  const local = git(root, "rev-parse", "HEAD").out;
  const remote = git(
    root,
    "ls-remote",
    "origin",
    `refs/heads/${ref}`,
  ).out.split("\t")[0];
  if (local !== remote) {
    throw new Error(`pushed ${local}, but origin/${ref} is ${remote}`);
  }
  console.log(`pushed ${local.slice(0, 10)} to ${ref}`);
}

/** Asks jsDelivr to drop its cached copy of each URL. A failure is reported, not fatal: it expires by itself. */
export async function purgeJsdelivr(
  urls: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<void> {
  for (const url of urls) {
    const path = url.replace(/^https:\/\/cdn\.jsdelivr\.net\//, "");
    try {
      const response = await fetcher(`https://purge.jsdelivr.net/${path}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`purged ${url}`);
    } catch (err) {
      console.warn(
        `warning: purging ${url} failed (${err instanceof Error ? err.message : err}); jsDelivr serves it once its branch cache lapses, up to twelve hours`,
      );
    }
  }
}

export async function publish(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
  const { values, switches } = parseFlags(argv, {
    verb: "publish",
    usage: PUBLISH_USAGE,
    values: ["--to", "--from", "--tag", "--uplink"],
    switches: ["--push", "--purge"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run publish inside an Uplink, or name one with --uplink <dir>.`,
    );
  }
  const declared: unknown = JSON.parse(
    readFileSync(join(uplinkDir, "uplink.json"), "utf8"),
  );
  const id = str(field(declared, "id"));
  const clientDir = join(uplinkDir, "client");
  const version = str(
    field(
      JSON.parse(readFileSync(join(clientDir, "package.json"), "utf8")),
      "version",
    ),
  );
  const tag = values.get("--tag");
  const wrongTag = tag ? tagFault(tag, id, version) : undefined;
  if (wrongTag) throw new Error(wrongTag);
  const plan = planPublish(id, str(field(field(declared, "client"), "url")));
  const from = values.get("--from")
    ? resolve(cwd, values.get("--from") as string)
    : join(clientDir, "dist", id);

  const to = values.get("--to");
  if (!to && !plan.ref) {
    throw new Error(
      `${id}: ${plan.url} is not a jsDelivr URL, so there is no branch to publish into. Name the folder it is served from with --to <dir>.`,
    );
  }
  const root = to
    ? resolve(cwd, to)
    : releasesCheckout(uplinkDir, plan.ref as string);
  const fault = to && plan.ref ? checkoutFault(root, plan.ref) : undefined;
  if (fault) throw new Error(`${id}: ${fault}`);

  const result = copyRelease(
    plan,
    from,
    root,
    join(clientDir, "docs", "spec.json"),
  );
  console.log(`${id}: published to ${result.target}`);
  console.log(`  bundle   ${result.bundleUrl}`);
  console.log(`  sidecar  ${result.sidecarUrl}`);
  if (result.specUrl) console.log(`  spec     ${result.specUrl}`);
  if (plan.owner) {
    console.log(
      `  every published version  https://cdn.jsdelivr.net/gh/${plan.owner}/${plan.repo}@${plan.ref}/${dirname(dirname(plan.treePath))}/`,
    );
  }
  if (switches.has("--push")) {
    if (!plan.ref) {
      throw new Error(
        "--push needs a jsDelivr URL, which names the branch to push.",
      );
    }
    pushRelease(root, plan.ref, `release: ${tag ?? `${id}-v${version}`}`);
  }
  if (!switches.has("--push") && plan.ref) {
    console.log(
      `\nCommit and push ${root} to ${plan.ref} (publish --push does both), then purge both URLs (--purge).`,
    );
  }
  if (switches.has("--purge")) {
    await purgeJsdelivr(
      [result.bundleUrl, result.sidecarUrl, result.specUrl].filter(
        (url): url is string => url !== undefined,
      ),
    );
  }
  return 0;
}
