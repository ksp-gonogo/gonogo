#!/usr/bin/env node
/**
 * The last steps of publishing the packages as a set: wait until each registry
 * really serves the version, then move every npm dist-tag together.
 *
 * The packages are published by separate jobs, minutes apart. While each moved
 * its own dist-tag as it finished, an author installing in between got two
 * packages at the new version and one at the old, which do not resolve
 * together, and a job that failed left the set mixed until someone ran it
 * again. nuget.org adds a delay of its own: a pushed version is accepted at
 * once and listed up to twenty minutes later, and a scaffold restoring it in
 * that window fails.
 *
 * So nothing an author installs by moves until everything exists. NuGet is
 * pushed first and waited for, each npm package is published under a holding
 * tag nobody installs by, each is read back from the registry, and only then
 * does one job move `rc` or `latest` for all of them, seconds apart. A tag it
 * cannot move makes it put back the ones it already moved.
 *
 * Usage:
 *   release-tags.mjs nuget-listed <id> <version> [--wait-minutes <n>] [--dry-run]
 *   release-tags.mjs npm-present <version> <name>... [--wait-minutes <n>] [--dry-run]
 *   release-tags.mjs move <tag> <version> <name>... [--dry-run]
 *   release-tags.mjs probe <name>...
 *
 * `--dry-run` reads everything and changes nothing: an absent version is
 * reported and is not a failure, and `move` prints the commands it would run.
 * `probe` is the one way to learn, without moving a tag anyone uses, whether
 * this workflow may move tags at all: it adds a throwaway tag to a version
 * already published and removes it again.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The tag each package is published under until the whole set is known to exist. */
export const HOLDING_TAG = "pending";

/** The tag `probe` adds and removes. Nobody installs by it. */
export const PROBE_TAG = "permission-probe";

const NPM_REGISTRY = "https://registry.npmjs.org";
const NUGET_FLAT = "https://api.nuget.org/v3-flatcontainer";

/** Asks every cache between here and the registry for the registry's own answer. */
const UNCACHED = {
  "cache-control": "no-cache, no-store",
  pragma: "no-cache",
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Whether nuget.org's flat container lists `version`, from its index document. */
export function nugetLists(index, version) {
  const versions = Array.isArray(index?.versions) ? index.versions : [];
  return versions.includes(version.toLowerCase());
}

/**
 * What moving `tag` to `version` means for each package, from the tags they
 * carry now: where the tag points today, and whether it has to move.
 */
export function planMoves(tagsByName, tag, version) {
  return Object.entries(tagsByName).map(([name, tags]) => ({
    name,
    from: tags?.[tag],
    to: version,
    needed: tags?.[tag] !== version,
  }));
}

/** The command that puts one package's tag back where a move found it. */
export function restoreCommand(move, tag) {
  return move.from === undefined
    ? ["dist-tag", "rm", move.name, tag]
    : ["dist-tag", "add", `${move.name}@${move.from}`, tag];
}

/**
 * Moves `tag` for every package that needs it, in order. When one move fails,
 * every move already made is put back and the failure is thrown, so the set is
 * left as it was found and never half moved.
 */
export function moveTogether(moves, tag, npm, log = console.log) {
  const moved = [];
  for (const move of moves) {
    if (!move.needed) {
      log(`${move.name}: ${tag} is already ${move.to}`);
      continue;
    }
    try {
      npm(["dist-tag", "add", `${move.name}@${move.to}`, tag]);
      moved.push(move);
      log(`${move.name}: ${tag} ${move.from ?? "(unset)"} -> ${move.to}`);
    } catch (err) {
      const stuck = [];
      for (const undo of moved.reverse()) {
        try {
          npm(restoreCommand(undo, tag));
          log(`${undo.name}: ${tag} put back to ${undo.from ?? "(unset)"}`);
        } catch {
          stuck.push(`npm ${restoreCommand(undo, tag).join(" ")}`);
        }
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `could not move ${tag} for ${move.name}: ${reason}\n` +
          (stuck.length === 0
            ? `Every tag this run had moved is back where it was, so ${tag} names the previous set.`
            : `These could NOT be put back, so ${tag} is mixed until someone runs them:\n  ${stuck.join("\n  ")}`),
      );
    }
  }
  return moved;
}

async function getJson(url) {
  const res = await fetch(url, { headers: UNCACHED });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Polls `read` until it returns something, for at most `minutes`. A registry error is retried, not read as absence. */
async function until(read, minutes, waiting) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    let last = "";
    try {
      const found = await read();
      if (found) return found;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= deadline) return undefined;
    console.log(`${waiting}${last ? ` (${last})` : ""}`);
    await sleep(30_000);
  }
}

const escaped = (name) => name.replace("/", "%2f");

/** A package's dist-tags, from the endpoint that serves only them. */
async function distTags(name) {
  return (
    (await getJson(`${NPM_REGISTRY}/-/package/${escaped(name)}/dist-tags`)) ??
    {}
  );
}

/** Whether the registry serves `name@version` and the tarball it names can be fetched. */
async function npmServes(name, version) {
  const doc = await getJson(`${NPM_REGISTRY}/${escaped(name)}/${version}`);
  const tarball = doc?.dist?.tarball;
  if (typeof tarball !== "string") return false;
  const res = await fetch(tarball, { method: "HEAD", headers: UNCACHED });
  return res.ok;
}

function flags(argv) {
  const rest = [];
  let minutes;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argv[i] === "--wait-minutes") {
      minutes = Number(argv[++i]);
      continue;
    }
    rest.push(argv[i]);
  }
  return { rest, minutes, dryRun };
}

const realNpm = (args) =>
  execFileSync("npm", args, {
    stdio: ["ignore", "inherit", "pipe"],
    encoding: "utf8",
  });

export async function main(argv, { npm = realNpm } = {}) {
  const [command, ...tail] = argv;
  const { rest, minutes, dryRun } = flags(tail);
  switch (command) {
    case "nuget-listed": {
      const [id, version] = rest;
      const url = `${NUGET_FLAT}/${id.toLowerCase()}/index.json`;
      const listed = async () => nugetLists(await getJson(url), version);
      if (dryRun) {
        console.log(
          (await listed())
            ? `${id} ${version} is listed on nuget.org.`
            : `${id} ${version} is not listed on nuget.org, as expected of a dry run that pushed nothing. A real run waits here for it.`,
        );
        return;
      }
      const limit = minutes ?? 45;
      if (
        !(await until(
          listed,
          limit,
          `waiting for nuget.org to list ${id} ${version}`,
        ))
      ) {
        throw new Error(
          `nuget.org did not list ${id} ${version} within ${limit} minutes of the push. No npm package was published and no tag moved. ` +
            "Check the package's page for a failed validation, then run this workflow again: a version already pushed is skipped and waited for.",
        );
      }
      console.log(`${id} ${version} is listed on nuget.org.`);
      return;
    }
    case "npm-present": {
      const [version, ...names] = rest;
      const limit = minutes ?? 10;
      const absent = [];
      for (const name of names) {
        const served = dryRun
          ? await npmServes(name, version).catch(() => false)
          : await until(
              () => npmServes(name, version),
              limit,
              `waiting for npm to serve ${name}@${version}`,
            );
        console.log(
          `${name}@${version}: ${served ? "served by the registry" : "ABSENT"}`,
        );
        if (!served) absent.push(name);
      }
      if (absent.length === 0) return;
      if (dryRun) {
        console.log(
          `Absent, as expected of a dry run that published nothing: ${absent.join(", ")}. A real run fails here and moves no tag.`,
        );
        return;
      }
      throw new Error(
        `the registry does not serve ${absent.map((name) => `${name}@${version}`).join(", ")} after ${limit} minutes. ` +
          "No dist-tag was moved, so every tag still names the previous set.",
      );
    }
    case "move": {
      const [tag, version, ...names] = rest;
      const tagsByName = {};
      for (const name of names) tagsByName[name] = await distTags(name);
      const moves = planMoves(tagsByName, tag, version);
      if (dryRun) {
        for (const move of moves) {
          console.log(
            move.needed
              ? `would run: npm dist-tag add ${move.name}@${move.to} ${tag}   (now ${move.from ?? "unset"}; to undo: npm ${restoreCommand(move, tag).join(" ")})`
              : `${move.name}: ${tag} is already ${move.to}`,
          );
        }
        console.log(
          "Dry run: no tag moved. Whether this workflow may move a tag is not something a read can show, since a public package's tags are readable by anyone: dispatch with tag_probe to find out.",
        );
        return;
      }
      moveTogether(moves, tag, npm);
      const settled = await until(
        async () => {
          for (const name of names) {
            if ((await distTags(name))[tag] !== version) return false;
          }
          return true;
        },
        5,
        `waiting for the registry to show ${tag} at ${version} for all of ${names.join(", ")}`,
      );
      if (!settled) {
        throw new Error(
          `every move was accepted, and the registry still does not show ${tag} at ${version} for all of ${names.join(", ")} after 5 minutes.`,
        );
      }
      console.log(`${tag} is ${version} for ${names.join(", ")}.`);
      return;
    }
    case "probe": {
      for (const name of rest) {
        const tags = await distTags(name);
        const version = tags.latest ?? Object.values(tags)[0];
        if (!version)
          throw new Error(`${name} has no published version to probe with`);
        npm(["dist-tag", "add", `${name}@${version}`, PROBE_TAG]);
        npm(["dist-tag", "rm", name, PROBE_TAG]);
        console.log(
          `${name}: this workflow may move dist-tags (added and removed ${PROBE_TAG} on ${version}).`,
        );
      }
      return;
    }
    default:
      throw new Error(
        "usage: release-tags.mjs nuget-listed <id> <version> | npm-present <version> <name>... | move <tag> <version> <name>... | probe <name>...",
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(
      `::error::${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
