import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { findUplinkDir } from "../../../cli/bake";
import type { CheckContext, FixableFinding, Rule } from "../../types";

/** The folders of an Uplink that hold a project, each compiled against the same contract. */
const PROJECT_FOLDERS = ["mod", "mod-contract", "mod-tests"];

/** NuGet packages every project may carry: the contract, the reference assemblies and the test SDK. */
const ALLOWED_PACKAGES = [
  /^KspGonogo\.Sitrep\.Contract$/,
  /^Microsoft\.NETFramework\.ReferenceAssemblies$/,
  /^Microsoft\.NET\.Test\.Sdk$/,
  /^xunit(?:\.|$)/,
  /^coverlet\./,
];

/** Where a referenced assembly may sit: the game's own folders and the parent mod's, and the codegen folder. */
const ALLOWED_HINT_ROOTS = [
  "$(KspManaged)",
  "$(KspGameData)",
  "$(KspRoot)",
  "$(GonogoCodegen)",
];

interface Reference {
  kind: "ProjectReference" | "PackageReference" | "Reference";
  include: string;
  hintPath?: string;
  line: number;
}

/** The project file with its comments blanked and its line count kept. */
const withoutComments = (xml: string): string =>
  xml.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));

export function referencesOf(xml: string): Reference[] {
  const text = withoutComments(xml);
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const out: Reference[] = [];
  const element =
    /<(ProjectReference|PackageReference|Reference)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of text.matchAll(element)) {
    const include = /\bInclude\s*=\s*"([^"]*)"/.exec(match[2])?.[1];
    if (include === undefined) continue;
    const hint =
      /<HintPath>\s*([^<]*?)\s*<\/HintPath>/.exec(match[4] ?? "")?.[1] ??
      /\bHintPath\s*=\s*"([^"]*)"/.exec(match[2])?.[1];
    out.push({
      kind: match[1] as Reference["kind"],
      include,
      hintPath: hint,
      line: lineAt(match.index ?? 0),
    });
  }
  return out;
}

function projectFiles(uplinkDir: string): string[] {
  return PROJECT_FOLDERS.flatMap((folder) => {
    const dir = join(uplinkDir, folder);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith(".csproj"))
          .map((name) => join(dir, name))
      : [];
  });
}

/** The reason a reference may not appear in an Uplink's project, or nothing. */
export function referenceFault(
  reference: Reference,
  project: string,
  uplinkDir: string,
): string | undefined {
  if (reference.kind === "PackageReference") {
    return ALLOWED_PACKAGES.some((allowed) => allowed.test(reference.include))
      ? undefined
      : `the package ${reference.include} is not the Contract package, the reference assemblies or the test SDK`;
  }
  if (reference.kind === "ProjectReference") {
    const target = resolve(
      project,
      "..",
      reference.include.replace(/\\/g, "/"),
    );
    const inside = relative(uplinkDir, target);
    return inside.startsWith("..") || inside.split(sep)[0] === ""
      ? `the project ${reference.include} lies outside this Uplink, so it is not its own contract slice`
      : undefined;
  }
  if (reference.hintPath === undefined) return undefined;
  return ALLOWED_HINT_ROOTS.some((root) => reference.hintPath?.startsWith(root))
    ? undefined
    : `the assembly ${reference.include} is read from ${reference.hintPath}, which is not under the game or the parent mod`;
}

export const pluginRule: Rule = {
  id: "plugin/references",
  group: "plugin",
  check({ clientDir }: CheckContext): FixableFinding[] {
    const uplinkDir = findUplinkDir(clientDir);
    if (!uplinkDir) return [];
    const out: FixableFinding[] = [];
    for (const project of projectFiles(uplinkDir)) {
      const xml = readFileSync(project, "utf8");
      for (const reference of referencesOf(xml)) {
        const fault = referenceFault(reference, project, uplinkDir);
        if (!fault) continue;
        out.push({
          rule: "plugin/references",
          severity: "warning",
          file: project,
          line: reference.line,
          message: `${fault}. A plugin built outside the gonogo repository reaches Gonogo through the Contract package alone, so this reference does not restore there.`,
          fixable: false,
          fix: "Reference Sitrep.Contract through its NuGet package, or declare the interface you need in the contract and resolve it through the host.",
        });
      }
    }
    return out;
  },
};

export const pluginRules: readonly Rule[] = [pluginRule];
