/**
 * What `uplink-tools new` needs to know, as one list.
 *
 * Each entry is a question, the flag that answers it, the default taken under
 * `--yes`, and how it is asked on a terminal. The flags the command accepts, its
 * `--help`, the prompts and the failure that names what is missing are all read
 * from this list, so none of them can say something the others do not.
 *
 * The rule the list serves: every question is a flag. With every flag given, or
 * with `--yes`, nothing is asked. With no terminal and no `--yes`, nothing is
 * asked either: the command stops and names every missing flag at once, so a
 * script or an agent fixes its call in one retry and is never left waiting on a
 * prompt nobody will answer.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ParsedFlags } from "./flags";

export interface Repository {
  owner: string;
  name: string;
}

export interface Answers {
  id: string;
  name: string;
  author: string;
  /** `null` when it has no repository yet: the client URL is then a placeholder that `release` refuses. */
  repo: Repository | null;
  /** `own`: the Uplink publishes Topics of its own. `core`: it only reads the ones Gonogo already publishes. */
  topics: "own" | "core";
  workflows: boolean;
  /** The KSP install to build against, or `null` to leave that for later. */
  ksp: string | null;
}

/** What a question can read besides the flags: where the command ran, and what earlier questions settled. */
export interface AskContext {
  cwd: string;
  /** What a sibling Uplink in the same repo already declares, when there is one. */
  inherited?: { author?: string; repo?: string };
  settled: Partial<Answers>;
}

/** The part of `@clack/prompts` the questions use, so it is loaded only when one is asked. */
export interface Prompter {
  text(options: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string | symbol>;
  select(options: {
    message: string;
    initialValue?: string;
    options: { value: string; label: string; hint?: string }[];
  }): Promise<string | symbol>;
  confirm(options: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;
  isCancel(value: unknown): value is symbol;
}

interface Question<Key extends keyof Answers> {
  key: Key;
  /** How the flag is written in `--help` and in the list of what is missing. */
  flag: string;
  help: string;
  /** Flags that take a value, and flags that take none. */
  values?: readonly string[];
  switches?: readonly string[];
  /** The answer the flags gave, or `undefined` when they gave none. Throws on an answer that cannot be used. */
  read(flags: ParsedFlags): Answers[Key] | undefined;
  /** The answer `--yes` takes, or `undefined` when there is nothing sensible to assume. */
  fallback(context: AskContext): Answers[Key] | undefined;
  ask(prompter: Prompter, context: AskContext): Promise<Answers[Key] | symbol>;
}

const ID_PATTERN = /^[a-z][a-z0-9]{1,29}$/;

export function validateUplinkId(id: string): string | undefined {
  if (ID_PATTERN.test(id)) return undefined;
  return (
    `"${id}" is not a usable Uplink id. It names a Topic prefix, a C# namespace and a ` +
    "GameData folder, so it is lowercase letters and digits only, starts with a letter " +
    "and is 2 to 30 characters long."
  );
}

export const pascal = (id: string): string => id[0].toUpperCase() + id.slice(1);

/** `owner/name`, from that or from a GitHub URL of the repository; `undefined` for anything else. */
export function parseRepository(value: string): Repository | undefined {
  const match =
    /^(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      value.trim(),
    );
  return match ? { owner: match[1], name: match[2] } : undefined;
}

/** The output of a git query, or `undefined` when git is absent, this is no repository or it has no answer. */
function git(cwd: string, args: readonly string[]): string | undefined {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/** The folder inside a KSP install that holds the game's assemblies, or `undefined` when `root` is not one. */
export function kspManagedDir(root: string): string | undefined {
  return [
    join(root, "KSP_Data", "Managed"),
    join(root, "KSP_x64_Data", "Managed"),
    join(root, "KSP.app", "Contents", "Resources", "Data", "Managed"),
  ].find((dir) => existsSync(join(dir, "Assembly-CSharp.dll")));
}

/** Where Steam puts the game on this platform, when the game is there. */
function steamInstall(): string | undefined {
  const game = join("steamapps", "common", "Kerbal Space Program");
  const candidates =
    process.platform === "darwin"
      ? [join(homedir(), "Library", "Application Support", "Steam", game)]
      : process.platform === "win32"
        ? [
            join("C:\\Program Files (x86)", "Steam", game),
            join("C:\\Program Files", "Steam", game),
          ]
        : [
            join(homedir(), ".steam", "steam", game),
            join(homedir(), ".local", "share", "Steam", game),
          ];
  return candidates.find((dir) => kspManagedDir(dir) !== undefined);
}

function readKsp(path: string, cwd: string): string {
  const root = resolve(cwd, path);
  if (kspManagedDir(root) === undefined) {
    throw new Error(
      `--ksp ${path} is not a KSP install: there is no Assembly-CSharp.dll under KSP_Data/Managed ` +
        "(or KSP.app on macOS) inside it. Give the folder that holds KSP_Data and GameData.",
    );
  }
  return root;
}

const question = <Key extends keyof Answers>(q: Question<Key>): Question<Key> =>
  q;

const defaultId = ({ cwd }: AskContext): string | undefined => {
  const dir = basename(resolve(cwd));
  return validateUplinkId(dir) === undefined ? dir : undefined;
};
const defaultName = ({ settled }: AskContext): string | undefined =>
  settled.id ? pascal(settled.id) : undefined;
const defaultAuthor = ({ cwd, inherited }: AskContext): string | undefined =>
  inherited?.author || git(cwd, ["config", "user.name"]);
// Beside sibling Uplinks the answer is "theirs", which the caller reads off the sibling, so the directory's own remote is not offered in its place.
const defaultRepo = ({ cwd, inherited }: AskContext): Repository | null =>
  inherited
    ? null
    : (parseRepository(git(cwd, ["remote", "get-url", "origin"]) ?? "") ??
      null);

/** Every question, in the order it is asked. */
export const QUESTIONS = [
  question({
    key: "id",
    flag: "<id>",
    help: "what the Uplink is called in code: its Topic prefix, C# namespace and GameData folder. Lowercase letters and digits, 2 to 30, starting with a letter",
    read: (flags) => {
      const id = flags.positionals[0];
      if (id === undefined) return undefined;
      const invalid = validateUplinkId(id);
      if (invalid) throw new Error(invalid);
      return id;
    },
    fallback: defaultId,
    ask: (prompter, context) =>
      prompter.text({
        message: "Uplink id (lowercase letters and digits)",
        initialValue: defaultId(context),
        validate: (value) => validateUplinkId(value ?? ""),
      }),
  }),
  question({
    key: "name",
    flag: "--name <name>",
    help: "the display name, shown in the app and on the generated page (default: the id, capitalised)",
    values: ["--name"],
    read: (flags) => flags.values.get("--name"),
    fallback: defaultName,
    ask: (prompter, context) =>
      prompter.text({
        message: "Display name",
        initialValue: defaultName(context),
        validate: (value) => (value?.trim() ? undefined : "It needs a name."),
      }),
  }),
  question({
    key: "author",
    flag: "--author <name>",
    help: "who wrote it. The app shows this when it asks an operator whether to load the client (default: git's user.name)",
    values: ["--author"],
    read: (flags) => flags.values.get("--author"),
    fallback: defaultAuthor,
    ask: (prompter, context) =>
      prompter.text({
        message: "Author, as an operator will see it",
        initialValue: defaultAuthor(context),
        validate: (value) =>
          value?.trim() ? undefined : "It needs an author.",
      }),
  }),
  question({
    key: "repo",
    flag: "--repo <owner>/<name> | --no-repo",
    help: "the GitHub repository it will be published from, which sets where the released client is fetched from. --no-repo leaves a placeholder that release refuses (default: this directory's origin remote, when it is on GitHub)",
    values: ["--repo"],
    switches: ["--no-repo"],
    read: (flags) => {
      const value = flags.values.get("--repo");
      if (value !== undefined && flags.switches.has("--no-repo")) {
        throw new Error("--repo and --no-repo answer the same question.");
      }
      if (flags.switches.has("--no-repo")) return null;
      if (value === undefined) return undefined;
      const repo = parseRepository(value);
      if (!repo) {
        throw new Error(
          `--repo "${value}" is not a GitHub repository. Give it as <owner>/<name>.`,
        );
      }
      return repo;
    },
    fallback: defaultRepo,
    ask: async (prompter, context) => {
      const found = defaultRepo(context);
      const answer = await prompter.text({
        message:
          "GitHub repository it will be published from, as owner/name (leave empty to decide later)",
        initialValue: found ? `${found.owner}/${found.name}` : "",
        validate: (value) =>
          !value?.trim() || parseRepository(value)
            ? undefined
            : "Write it as owner/name, or leave it empty.",
      });
      if (typeof answer !== "string") return answer;
      return parseRepository(answer) ?? null;
    },
  }),
  question({
    key: "topics",
    flag: "--topics own | core",
    help: "own: it publishes Topics of its own, so it gets a C# contract slice and generated client types. core: it only reads Topics Gonogo already publishes (default: own)",
    values: ["--topics"],
    read: (flags) => {
      const value = flags.values.get("--topics");
      if (value === undefined) return undefined;
      if (value !== "own" && value !== "core") {
        throw new Error(`--topics is "own" or "core", not "${value}".`);
      }
      return value;
    },
    fallback: () => "own",
    ask: async (prompter) => {
      const answer = await prompter.select({
        message: "Which Topics will its widgets read?",
        initialValue: "own",
        options: [
          {
            value: "own",
            label: "Topics of its own",
            hint: "the plugin publishes them; adds a C# contract slice and generated client types",
          },
          {
            value: "core",
            label: "Only Topics Gonogo already publishes",
            hint: "the plugin exists to announce the client",
          },
        ],
      });
      if (typeof answer !== "string") return answer;
      return answer === "core" ? "core" : "own";
    },
  }),
  question({
    key: "workflows",
    flag: "--workflows | --no-workflows",
    help: "write a GitHub Actions workflow that checks both halves on every push (default: no)",
    switches: ["--workflows", "--no-workflows"],
    read: (flags) => {
      const yes = flags.switches.has("--workflows");
      const no = flags.switches.has("--no-workflows");
      if (yes && no) {
        throw new Error(
          "--workflows and --no-workflows answer the same question.",
        );
      }
      return yes ? true : no ? false : undefined;
    },
    fallback: () => false,
    ask: (prompter) =>
      prompter.confirm({
        message:
          "Set up a GitHub Actions workflow that checks it on every push?",
        initialValue: false,
      }),
  }),
  question({
    key: "ksp",
    flag: "--ksp <path> | --no-ksp",
    help: "your KSP install, the folder holding KSP_Data and GameData, for a plugin that references the game's assemblies. Kept out of git. The scaffold itself needs no game (default: Steam's install, when it is there)",
    values: ["--ksp"],
    switches: ["--no-ksp"],
    read: (flags) => {
      const value = flags.values.get("--ksp");
      if (value !== undefined && flags.switches.has("--no-ksp")) {
        throw new Error("--ksp and --no-ksp answer the same question.");
      }
      if (flags.switches.has("--no-ksp")) return null;
      return value === undefined ? undefined : value;
    },
    fallback: () => steamInstall() ?? null,
    ask: async (prompter, context) => {
      const answer = await prompter.text({
        message:
          "KSP install to build against (leave empty to skip: the scaffold needs no game)",
        initialValue: steamInstall() ?? "",
        validate: (value) =>
          !value?.trim() || kspManagedDir(resolve(context.cwd, value.trim()))
            ? undefined
            : "No Assembly-CSharp.dll under KSP_Data/Managed in that folder.",
      });
      if (typeof answer !== "string") return answer;
      return answer.trim() ? answer.trim() : null;
    },
  }),
] as const;

/** Every flag the questions read, for the command's flag parser. */
export const QUESTION_VALUES: readonly string[] = QUESTIONS.flatMap(
  (q) => q.values ?? [],
);
export const QUESTION_SWITCHES: readonly string[] = QUESTIONS.flatMap(
  (q) => q.switches ?? [],
);

/** The questions as `--help` lists them, wrapped under their flags. */
export function questionHelp(): string {
  const wrap = (text: string, width: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
        continue;
      }
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  };
  return QUESTIONS.map(
    (q) =>
      `  ${q.flag}\n${wrap(q.help, 70)
        .map((line) => `      ${line}`)
        .join("\n")}`,
  ).join("\n");
}

/** Thrown when answers are missing and nothing can be asked. The command exits 2 on it. */
export class MissingAnswers extends Error {}

/** Thrown when the person at the terminal cancels a prompt. Nothing has been written. */
export class Cancelled extends Error {}

export interface ResolveOptions {
  flags: ParsedFlags;
  cwd: string;
  /** `--yes`: take the default for anything the flags left open. */
  yes: boolean;
  /** Whether there is a terminal to ask on. */
  interactive: boolean;
  inherited?: AskContext["inherited"];
  /** Loads the prompt library. Called at most once, and only when a question is really asked. */
  loadPrompter: () => Promise<Prompter>;
}

/**
 * The answer to every question: from the flags, then from `--yes` or from a
 * prompt. Fails naming every flag still missing when neither can supply one.
 */
export async function resolveAnswers(
  options: ResolveOptions,
): Promise<Answers> {
  const context: AskContext = {
    cwd: options.cwd,
    inherited: options.inherited,
    settled: {},
  };
  const missing: string[] = [];
  let prompter: Prompter | undefined;

  // One question at a time and in order, since a later default reads an earlier answer.
  const resolveOne = async <Key extends keyof Answers>(
    q: Question<Key>,
  ): Promise<void> => {
    const given = q.read(options.flags);
    if (given !== undefined) {
      context.settled[q.key] = given;
      return;
    }
    if (options.yes) {
      const assumed = q.fallback(context);
      if (assumed === undefined) missing.push(q.flag);
      else context.settled[q.key] = assumed;
      return;
    }
    if (!options.interactive) {
      missing.push(q.flag);
      return;
    }
    prompter ??= await options.loadPrompter();
    const answered = await q.ask(prompter, context);
    if (prompter.isCancel(answered)) {
      throw new Cancelled("Cancelled. Nothing was written.");
    }
    context.settled[q.key] = answered;
  };
  await resolveOne(QUESTIONS[0]);
  await resolveOne(QUESTIONS[1]);
  await resolveOne(QUESTIONS[2]);
  await resolveOne(QUESTIONS[3]);
  await resolveOne(QUESTIONS[4]);
  await resolveOne(QUESTIONS[5]);
  await resolveOne(QUESTIONS[6]);

  if (missing.length > 0) {
    const list = missing.map((flag) => `  ${flag}`).join("\n");
    throw new MissingAnswers(
      options.yes
        ? `uplink-tools new: --yes has no default for:\n${list}\nPass ${missing.length === 1 ? "it" : "them"}.`
        : `uplink-tools new: stdin is not a terminal, so nothing can be asked. Missing:\n${list}\n` +
            "Pass them, or --yes to take the defaults.",
    );
  }

  const { id, name, author, repo, topics, workflows, ksp } = context.settled;
  if (
    id === undefined ||
    name === undefined ||
    author === undefined ||
    repo === undefined ||
    topics === undefined ||
    workflows === undefined ||
    ksp === undefined
  ) {
    throw new Error("unreachable: every question was settled or reported");
  }
  return {
    id,
    name,
    author,
    repo,
    topics,
    workflows,
    ksp: ksp === null ? null : readKsp(ksp, options.cwd),
  };
}
