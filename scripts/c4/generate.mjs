#!/usr/bin/env node
/**
 * Draws the project's C4 diagram with LikeC4, read from the tree.
 *
 * It reads the workspace package graph, the mod's C# project references and
 * source layout, the generated contract (Topic and command ids), and every
 * Uplink's manifests, widget listing and contract slice in this repository and
 * in a gonogo-uplinks clone beside it. `facts.mjs` adds what the code cannot
 * say. The model is written to `.c4/model/` and built into a static site in
 * `.c4/site/`, both ignored by git.
 *
 *   pnpm c4                          write the model and build the site
 *   pnpm c4 --serve                  write the model and open the live preview
 *   pnpm c4 --png <dir>              also export every view as a PNG
 *   pnpm c4 --out <dir>              build the site somewhere else
 *   pnpm c4 --uplinks <dir>          read the Uplinks from another clone
 *   pnpm c4 --model-only             write the model and stop
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as facts from "./facts.mjs";

const LIKEC4 = "likec4@1.59.4";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function option(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const WORK = join(ROOT, ".c4");
const MODEL_DIR = join(WORK, "model");
const SITE_DIR = resolve(option("--out") ?? join(WORK, "site"));
const PNG_DIR = option("--png") ? resolve(option("--png")) : undefined;
const UPLINKS_ROOT = resolve(
  option("--uplinks") ?? join(ROOT, "..", "gonogo-uplinks"),
);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const dirs = (p) =>
  isDir(p)
    ? readdirSync(p).filter(
        (n) => isDir(join(p, n)) && !["bin", "obj", "node_modules"].includes(n),
      )
    : [];
/** Every non-test TS source under `dir`. */
function sourceFiles(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter(
      (f) =>
        /\.tsx?$/.test(f) && !/\.test(-d)?\.tsx?$|__tests__|\/test\//.test(f),
    )
    .map((f) => join(dir, f));
}
const camel = (s) => s.replace(/[-.](\w)/g, (_, c) => c.toUpperCase());
/** LikeC4 words that cannot name an element. */
const RESERVED = new Set(
  "notes title description summary technology style link links metadata icon color shape model views view include exclude element it this extend group deployment dynamic global specification tag kind instanceOf navigateTo where with".split(
    " ",
  ),
);
const ident = (s) => {
  const id = s.replace(/[^A-Za-z0-9_]/g, "_");
  const safe = /^[A-Za-z]/.test(id) ? id : `x${id}`;
  return RESERVED.has(safe) ? `${safe}_` : safe;
};

/** id → { kind, title, technology, description, tags, metadata, parent } */
const elements = new Map();
const relations = [];
const warnings = [];

function addElement(id, props) {
  if (elements.has(id)) throw new Error(`duplicate element ${id}`);
  const parent = id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null;
  if (parent && !elements.has(parent))
    throw new Error(`element ${id} has no parent ${parent}`);
  elements.set(id, { tags: [], ...props, parent });
  return id;
}
function relate(from, to, title, extra = {}) {
  relations.push({ from, to, title, kind: extra.kind ?? "uses", ...extra });
}
const describe = (id, fallback) => facts.describe[id] ?? fallback;

for (const [id, p] of Object.entries(facts.people))
  addElement(id, { kind: "person", ...p });
for (const [id, e] of Object.entries(facts.externals))
  addElement(id, { kind: "external", ...e });
for (const [id, p] of Object.entries(facts.kspParts))
  addElement(`ksp.${id}`, { kind: "externalPart", ...p });

addElement("gonogo", {
  kind: "system",
  title: "gonogo",
  technology: "mission control for KSP",
  description:
    "A browser mission control: a main screen on the game machine, station screens for everyone else, and the mod that feeds them",
});
for (const [id, c] of Object.entries(facts.containers))
  addElement(`gonogo.${id}`, { kind: "container", ...c });

const workspaceGlobs = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*-\s*'?([^']+)'?\s*$/)?.[1])
  .filter(Boolean);
function expandGlob(glob) {
  const parts = glob.split("/");
  let found = [ROOT];
  for (const part of parts)
    found = found.flatMap((d) =>
      part === "*" ? dirs(d).map((n) => join(d, n)) : [join(d, part)],
    );
  return found.filter((d) => existsSync(join(d, "package.json")));
}
const packages = new Map();
for (const dir of workspaceGlobs.flatMap(expandGlob)) {
  const pkg = readJson(join(dir, "package.json"));
  if (!pkg.name?.startsWith("@ksp-gonogo/")) continue;
  const internal = Object.keys({
    ...pkg.dependencies,
    ...pkg.peerDependencies,
  }).filter((d) => d.startsWith("@ksp-gonogo/"));
  packages.set(pkg.name, { dir, pkg, internal });
}

const PUBLISHED = {
  "@ksp-gonogo/sitrep-sdk": "sdk",
  "@ksp-gonogo/ui-kit": "uikit",
  "@ksp-gonogo/uplink-tools": "uplinkTools",
};
const DEVTOOL_PACKAGES = new Set(
  ["storybook", "test-utils", "sitrep-server", "sitrep-kernel"].map(
    (n) => `@ksp-gonogo/${n}`,
  ),
);
const packageElement = new Map();

for (const [name, short] of Object.entries(PUBLISHED)) {
  const p = packages.get(name);
  if (!p) throw new Error(`published package ${name} is missing`);
  if (p.pkg.private) throw new Error(`${name} is marked private`);
  addElement(`gonogo.${short}`, {
    kind: "library",
    title: name,
    technology: `npm, ${relative(ROOT, p.dir)}`,
    description: describe(short, p.pkg.description),
  });
  packageElement.set(name, `gonogo.${short}`);
}
for (const name of [...packages.keys()].filter((n) => !PUBLISHED[n])) {
  const p = packages.get(name);
  if (!p.pkg.private) throw new Error(`${name} is public but not drawn`);
}

/** Every private package the app reaches, drawn as a main-screen component. */
const appClosure = new Set();
(function walk(name) {
  for (const dep of packages.get(name)?.internal ?? []) {
    if (appClosure.has(dep) || PUBLISHED[dep]) continue;
    appClosure.add(dep);
    walk(dep);
  }
})("@ksp-gonogo/app");
appClosure.add("@ksp-gonogo/app");

const isUplinkClient = (dir) => /\/mod\/Gonogo\w+Uplink\/client$/.test(dir);
for (const name of [...appClosure].sort()) {
  const p = packages.get(name);
  if (isUplinkClient(p.dir)) continue;
  const short = camel(name.replace("@ksp-gonogo/", ""));
  const id = `gonogo.main.${short}`;
  addElement(id, {
    kind: "component",
    title: name,
    technology: relative(ROOT, p.dir),
    description: describe(`main.${short}`, p.pkg.description ?? ""),
  });
  packageElement.set(name, id);
}
for (const name of [...DEVTOOL_PACKAGES].sort()) {
  const p = packages.get(name);
  if (!p) continue;
  const short = camel(name.replace("@ksp-gonogo/", ""));
  const id = `gonogo.devtools.${short}`;
  addElement(id, {
    kind: "component",
    title: name,
    technology: relative(ROOT, p.dir),
    description: describe(`devtools.${short}`, p.pkg.description ?? ""),
  });
  packageElement.set(name, id);
}
packageElement.set("@ksp-gonogo/relay", "gonogo.relay");
for (const name of packages.keys()) {
  const p = packages.get(name);
  if (!packageElement.has(name) && !isUplinkClient(p.dir))
    warnings.push(`package ${name} is not drawn`);
}

/* App modules: each folder under packages/app/src */

const APP_SRC = join(ROOT, "packages/app/src");
const SKIP_APP_DIRS = new Set(["__tests__", "test", "styles", "a11y"]);
for (const d of dirs(APP_SRC).sort()) {
  if (SKIP_APP_DIRS.has(d)) continue;
  addElement(`gonogo.main.app.${ident(d)}`, {
    kind: "component",
    title: d,
    technology: `packages/app/src/${d}`,
    description: describe(`main.app.${d}`, ""),
  });
}
for (const d of dirs(APP_SRC)) {
  const from = `gonogo.main.app.${ident(d)}`;
  if (!elements.has(from)) continue;
  const used = new Set();
  for (const file of sourceFiles(join(APP_SRC, d)))
    for (const m of readFileSync(file, "utf8").matchAll(
      /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const target = relative(APP_SRC, resolve(dirname(file), m[1])).split(
        "/",
      )[0];
      if (target !== d) used.add(target);
    }
  for (const t of used) {
    const to = `gonogo.main.app.${ident(t)}`;
    if (elements.has(to)) relate(from, to, "imports", { kind: "imports" });
  }
}

/* Built-in widgets: each component folder under packages/components/src */

const COMPONENTS_SRC = join(ROOT, "packages/components/src");
for (const d of dirs(COMPONENTS_SRC).sort()) {
  if (!/^[A-Z]/.test(d)) continue;
  addElement(`gonogo.main.components.${ident(d)}`, {
    kind: "widget",
    title: d.replace(/([a-z])([A-Z])/g, "$1 $2"),
    technology: `packages/components/src/${d}`,
    description: "",
  });
}

for (const [id, title] of Object.entries(facts.stationComponents))
  addElement(`gonogo.station.${id}`, {
    kind: "component",
    title,
    description: describe(`station.${id}`, ""),
  });

const RELAY_SRC = join(ROOT, "packages/relay/src");
for (const f of readdirSync(RELAY_SRC).sort()) {
  if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "version.ts")
    continue;
  const id = f.replace(/\.ts$/, "");
  addElement(`gonogo.relay.${id}`, {
    kind: "component",
    title: id === "coturnManager" ? "coturn TURN server" : id,
    technology: `packages/relay/src/${f}`,
    description: describe(`relay.${id}`, ""),
  });
}

for (const [name, p] of packages) {
  const from = packageElement.get(name);
  if (!from) continue;
  for (const dep of p.internal) {
    const to = packageElement.get(dep);
    if (to && to !== from) relate(from, to, "imports", { kind: "imports" });
  }
}

/* The mod: C# projects, their references and their source layout */

const MOD = join(ROOT, "mod");
const csprojects = new Map();
for (const d of dirs(MOD)) {
  const file = join(MOD, d, `${d}.csproj`);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const refs = [...text.matchAll(/ProjectReference\s+Include="([^"]+)"/g)].map(
    (m) => basename(m[1].replace(/\\/g, "/"), ".csproj"),
  );
  csprojects.set(d, { refs, text });
}
const shipped = new Set();
(function walk(name) {
  if (shipped.has(name)) return;
  shipped.add(name);
  for (const r of csprojects.get(name)?.refs ?? []) walk(r);
})("Gonogo.KSP");

const MOD_SHORT = {
  "Gonogo.KSP": "plugin",
  "Sitrep.Host": "host",
  "Sitrep.Core": "core",
  "Sitrep.Transport": "transport",
  "Sitrep.Propagation": "propagation",
  "Sitrep.Contract": "contract",
};
const csElement = new Map([["Sitrep.Contract.Package", "gonogo.nuget"]]);
addElement("gonogo.nuget", {
  kind: "library",
  title: "KspGonogo.Sitrep.Contract",
  technology: "NuGet, mod/Sitrep.Contract.Package",
  description: describe("nuget", ""),
});
for (const name of [...shipped].sort()) {
  const short = MOD_SHORT[name];
  if (!short) throw new Error(`shipped C# project ${name} has no short id`);
  addElement(`gonogo.mod.${short}`, {
    kind: "component",
    title: name,
    technology: `C#, mod/${name}`,
    description: describe(`mod.${short}`, ""),
  });
  csElement.set(name, `gonogo.mod.${short}`);
}
for (const name of [...csprojects.keys()].sort()) {
  if (csElement.has(name) || /\.(Integration)?Tests$/.test(name)) continue;
  if (/Uplink$/.test(name)) continue;
  const id = `gonogo.devtools.${ident(camel(name.replace(/^(Sitrep|Gonogo)\./, "")))}`;
  addElement(id, {
    kind: "component",
    title: name,
    technology: `C#, mod/${name}`,
    description:
      csprojects.get(name).text.match(/<Description>([^<]+)</)?.[1] ?? "",
  });
  csElement.set(name, id);
}
for (const [name, { refs }] of csprojects) {
  const from = csElement.get(name);
  if (!from) continue;
  for (const r of refs) {
    const to = csElement.get(r);
    if (to && to !== from) relate(from, to, "references", { kind: "imports" });
  }
}

const HOST = join(MOD, "Sitrep.Host");
const hostFiles = readdirSync(HOST).filter((f) => f.endsWith(".cs"));
addElement("gonogo.mod.host.channelEngine", {
  kind: "component",
  title: "ChannelEngine",
  technology: hostFiles.filter((f) => f.startsWith("ChannelEngine")).join(", "),
  description: describe("mod.host.channelEngine", ""),
});
addElement("gonogo.mod.host.uplinkDiscovery", {
  kind: "component",
  title: "UplinkDiscovery",
  technology: "Sitrep.Host/UplinkDiscovery.cs",
  description: describe("mod.host.uplinkDiscovery", ""),
});
for (const [group, suffix] of [
  ["viewProviders", "ViewProvider"],
  ["commandProviders", "CommandProvider"],
]) {
  addElement(`gonogo.mod.host.${group}`, {
    kind: "component",
    title: group === "viewProviders" ? "View providers" : "Command providers",
    description: describe(`mod.host.${group}`, ""),
  });
  for (const f of hostFiles.filter((f) => f.endsWith(`${suffix}.cs`)).sort()) {
    const n = f.replace(/\.cs$/, "");
    addElement(`gonogo.mod.host.${group}.${ident(n)}`, {
      kind: "component",
      title: n.replace(suffix, ""),
      technology: `Sitrep.Host/${f}`,
      description: "",
    });
    relate(
      `gonogo.mod.host.${group}.${ident(n)}`,
      "gonogo.mod.contract",
      "shapes payloads of",
    );
  }
}
for (const d of dirs(HOST).sort())
  addElement(`gonogo.mod.host.${ident(d)}`, {
    kind: "component",
    title: d,
    technology: `Sitrep.Host/${d}`,
    description: describe(`mod.host.${d}`, ""),
  });
relate(
  "gonogo.mod.host.viewProviders",
  "gonogo.mod.host.channelEngine",
  "publish through",
);
relate(
  "gonogo.mod.host.channelEngine",
  "gonogo.mod.host.commandProviders",
  "routes commands to",
);
relate(
  "gonogo.mod.host.channelEngine",
  "gonogo.mod.transport",
  "writes frames to",
);
relate(
  "gonogo.mod.host.channelEngine",
  "gonogo.mod.host.Comms",
  "delays by signal time through",
);

const KSPDIR = join(MOD, "Gonogo.KSP");
addElement("gonogo.mod.plugin.coreUplinks", {
  kind: "component",
  title: "Core Uplinks",
  description: describe("mod.plugin.coreUplinks", ""),
});
const coreUplinkFiles = [
  ...readdirSync(KSPDIR).filter((f) => f.endsWith("Uplink.cs")),
  ...dirs(KSPDIR).flatMap((d) =>
    readdirSync(join(KSPDIR, d))
      .filter((f) => f.endsWith("Uplink.cs"))
      .map((f) => `${d}/${f}`),
  ),
].sort();
const coreUplinkIds = new Map();
for (const f of coreUplinkFiles) {
  const n = basename(f, ".cs");
  const id = `gonogo.mod.plugin.coreUplinks.${ident(n)}`;
  addElement(id, {
    kind: "component",
    title: n.replace(/Uplink$/, ""),
    technology: `Gonogo.KSP/${f}`,
    description: "",
  });
  coreUplinkIds.set(n.toLowerCase(), id);
}
for (const d of dirs(KSPDIR).sort())
  addElement(`gonogo.mod.plugin.${ident(d)}`, {
    kind: "component",
    title: d,
    technology: `Gonogo.KSP/${d}`,
    description: describe(`mod.plugin.${d}`, ""),
  });
relate(
  "gonogo.mod.plugin.coreUplinks",
  "gonogo.mod.host.viewProviders",
  "register",
);
relate(
  "gonogo.mod.host.commandProviders",
  "gonogo.mod.plugin",
  "apply commands through the game actuators in",
);

/* The contract: Topic and command ids, grouped by domain */

/** Read the string list a generated map exports under `name`. */
function idList(file, name) {
  if (!existsSync(file)) return [];
  const m = readFileSync(file, "utf8").match(
    new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`),
  );
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}
/** Topic id → payload type, from the generated payload map. */
function payloadTypes(file) {
  if (!existsSync(file)) return {};
  const m = readFileSync(file, "utf8").match(
    /interface GeneratedTopicPayloadMap\s*\{([^}]*)\}/,
  );
  return Object.fromEntries(
    [...(m?.[1] ?? "").matchAll(/"([^"]+)":\s*([^;]+);/g)].map((x) => [
      x[1],
      x[2].trim(),
    ]),
  );
}

const topicElement = new Map();
const commandElement = new Map();
const domainElement = new Map();

function addContract(parent, topics, commands, types, label) {
  const byDomain = new Map();
  for (const t of topics) byDomain.set(t.split(".")[0], []);
  for (const c of commands) byDomain.set(c.split(".")[0], []);
  for (const domain of [...byDomain.keys()].sort()) {
    const dId = `${parent}.${ident(`d_${domain}`)}`;
    const own = topics.filter((t) => t.startsWith(`${domain}.`));
    const cmds = commands.filter((c) => c.startsWith(`${domain}.`));
    addElement(dId, {
      kind: "domain",
      title: `${domain}.*`,
      technology: `${own.length} Topics, ${cmds.length} commands`,
      description: `${label} domain ${domain}`,
    });
    domainElement.set(`${parent}|${domain}`, dId);
    for (const t of own) {
      const id = `${dId}.${ident(`t_${t.slice(domain.length + 1)}`)}`;
      addElement(id, {
        kind: "topic",
        title: t,
        technology: types[t] ?? "",
        description: "",
      });
      topicElement.set(t, id);
    }
    for (const c of cmds) {
      const id = `${dId}.${ident(`c_${c.slice(domain.length + 1)}`)}`;
      addElement(id, {
        kind: "command",
        title: c,
        technology: "command",
        description: "",
      });
      commandElement.set(c, id);
    }
  }
}

const SDK_GEN = join(MOD, "sitrep-sdk/src/__generated__");
const contractVersion = readFileSync(
  join(MOD, "Sitrep.Contract/ContractVersion.cs"),
  "utf8",
);
const CONTRACT_MAJOR = Number(
  contractVersion.match(/int\s+Major\s*=\s*(\d+)/)[1],
);
const CONTRACT_MINOR = Number(
  contractVersion.match(/int\s+Minor\s*=\s*(\d+)/)[1],
);
const EXT_API = readFileSync(
  join(MOD, "sitrep-sdk/src/compat-versions.ts"),
  "utf8",
).match(/EXTENSION_API_VERSION[^=]*=\s*"([^"]+)"/)[1];
elements.get("gonogo.mod.contract").technology =
  `C#, contract ${CONTRACT_MAJOR}.${CONTRACT_MINOR}, extension API ${EXT_API}`;

addContract(
  "gonogo.mod.contract",
  idList(join(SDK_GEN, "topic-map.ts"), "GENERATED_TOPIC_IDS"),
  idList(join(SDK_GEN, "command-map.ts"), "GENERATED_COMMAND_IDS"),
  payloadTypes(join(SDK_GEN, "topic-map.ts")),
  "Core",
);

addElement("uplinks", {
  kind: "system",
  title: "Uplinks",
  technology: "add-ons, one per KSP mod",
  description:
    "Each Uplink brings one mod's data to gonogo: a C# half loaded by the Gonogo mod and a client half of widgets loaded by the app",
});

function findUplinks() {
  const found = [];
  const local = dirs(MOD)
    .filter((d) => /^Gonogo\w+Uplink$/.test(d))
    .map((d) => ({ dir: join(MOD, d), source: "bundled with the mod" }));
  const external = dirs(join(UPLINKS_ROOT, "uplinks")).map((d) => ({
    dir: join(UPLINKS_ROOT, "uplinks", d),
    source: "gonogo-uplinks",
  }));
  if (!isDir(join(UPLINKS_ROOT, "uplinks")))
    warnings.push(
      `no gonogo-uplinks clone at ${UPLINKS_ROOT}: only the bundled Uplinks are drawn`,
    );
  for (const u of [...local, ...external]) {
    const uplinkJson = join(u.dir, "uplink.json");
    const manifest = join(u.dir, "client/gonogo-uplink.json");
    if (!existsSync(uplinkJson) && !existsSync(manifest)) continue;
    found.push({
      ...u,
      descriptor: existsSync(uplinkJson) ? readJson(uplinkJson) : {},
      manifest: existsSync(manifest) ? readJson(manifest) : undefined,
    });
  }
  return found;
}

const uplinkList = findUplinks();
const widgetReads = [];
for (const u of uplinkList) {
  const id = u.manifest?.id ?? u.descriptor.id;
  const uId = `uplinks.${ident(id)}`;
  const m = u.manifest;
  const contract = m ? `${m.contractMajor}.${m.contractMinor}` : undefined;
  const tags = [];
  if (m && m.contractMajor !== CONTRACT_MAJOR) tags.push("olderContract");
  if (!m) tags.push("noClient");
  addElement(uId, {
    kind: "uplink",
    title: m?.name ?? u.descriptor.name ?? id,
    technology: m
      ? `contract ${contract}, extension API ${m.apiVersion}`
      : "C# only, no client",
    description:
      m?.description ?? `C# Uplink for ${u.descriptor.mod?.name ?? id}`,
    tags,
    metadata: {
      source: u.source,
      version: m?.version ?? "",
      contract: contract ?? "",
      extensionApi: m?.apiVersion ?? "",
      wraps: u.descriptor.mod
        ? `${u.descriptor.mod.name} ${u.descriptor.mod.builtAgainst ?? ""}`.trim()
        : "",
    },
  });

  /* Its C# half: its own plugin, or one of the mod's core Uplinks */
  let csHalf;
  if (isDir(join(u.dir, "mod"))) {
    csHalf = addElement(`${uId}.mod`, {
      kind: "component",
      title: u.descriptor.dll ?? `${id} plugin`,
      technology: `C# plugin, GameData/${u.descriptor.gamedata ?? "?"}`,
      description: "Loaded into KSP beside the Gonogo mod",
    });
    relate(csHalf, "gonogo.nuget", "built against", {
      technology: contract
        ? `contract ${contract}`
        : "contract not recorded: no client manifest",
    });
    relate("gonogo.mod.host.uplinkDiscovery", csHalf, "loads");
  } else {
    csHalf = coreUplinkIds.get(`${id.toLowerCase()}uplink`);
    if (csHalf) relate(csHalf, uId, "is the C# half of");
    else warnings.push(`Uplink ${id} has no C# half drawn`);
  }
  if (u.descriptor.mod) {
    const modId = `ksp.mod_${ident(id)}`;
    addElement(modId, {
      kind: "externalPart",
      title: u.descriptor.mod.name,
      technology:
        `${u.descriptor.mod.tier ?? ""} ${u.descriptor.mod.builtAgainst ?? ""}`.trim(),
      description: `Third-party KSP mod, wrapped by the ${m?.name ?? id} Uplink`,
    });
    if (csHalf) relate(csHalf, modId, "reads and drives");
  }
  if (!u.descriptor.mod && facts.uplinkWraps[id])
    relate(uId, facts.uplinkWraps[id], "reads and drives");

  /* Its contract slice */
  const gen = join(u.dir, "client/src/__generated__");
  addContract(
    uId,
    idList(join(gen, "topic-map.ts"), "GENERATED_TOPIC_IDS"),
    idList(join(gen, "command-map.ts"), "GENERATED_COMMAND_IDS"),
    payloadTypes(join(gen, "topic-map.ts")),
    m?.name ?? id,
  );
  if (csHalf)
    for (const [key, dId] of domainElement)
      if (key.startsWith(`${uId}|`))
        relate(csHalf, dId, "publishes", { kind: "telemetry" });

  /* Its client half and widgets */
  if (m) {
    const cId = addElement(`${uId}.client`, {
      kind: "component",
      title: `${id} client`,
      technology: `JS bundle, ${m.bundleUrl}`,
      description: `Widgets, registered on import. Built with sdk ${m.sdkVersion}`,
    });
    relate(cId, "gonogo.sdk", "built against", {
      technology: `extension API ${m.apiVersion}`,
    });
    relate(cId, "gonogo.uikit", "imports");
    relate("gonogo.main.app.uplinks", cId, "imports the bundle");
    const widgetsFile = join(u.dir, "client/docs/widgets.json");
    const widgets = existsSync(widgetsFile)
      ? readJson(widgetsFile).widgets
      : [];
    for (const w of widgets) {
      const wId = addElement(`${cId}.${ident(w.id)}`, {
        kind: "widget",
        title: w.name,
        technology: `widget ${w.id}`,
        description: w.description ?? "",
      });
      widgetReads.push({
        uId,
        wId,
        w,
        commands: new Set(
          (w.commands ?? []).map((c) => (typeof c === "string" ? c : c.id)),
        ),
      });
    }
    /*
     * widgets.json lists no commands, so a widget's commands are read from
     * the `useCommand(...)` calls in the source folder that registers it, or
     * failing that the folder that names its id.
     * A folder that registers no listed widget gives its commands to the
     * client as a whole.
     */
    const src = join(u.dir, "client/src");
    for (const d of dirs(src)) {
      const text = sourceFiles(join(src, d))
        .map((f) => readFileSync(f, "utf8"))
        .join("\n");
      const cmds = [
        ...text.matchAll(
          /useCommand(?:<[^>]*>)?\(\s*(?:["']([^"']+)["']|([A-Za-z_]\w*))/g,
        ),
      ]
        .map(
          (x) =>
            x[1] ??
            text.match(new RegExp(`\\b${x[2]}\\s*=\\s*["']([^"']+)["']`))?.[1],
        )
        .filter(Boolean);
      if (!cmds.length) continue;
      const mine = widgetReads.filter((r) => r.w && r.uId === uId);
      const registers = mine.filter((r) =>
        new RegExp(`id:\\s*["']${r.w.id}["']`).test(text),
      );
      const owners = registers.length
        ? registers
        : mine.filter((r) => text.includes(`"${r.w.id}"`));
      if (owners.length)
        for (const o of owners) for (const c of cmds) o.commands.add(c);
      else
        for (const c of cmds)
          widgetReads.push({ uId, wId: cId, w: null, commands: new Set([c]) });
    }
  }
}

/** Match a channel or field path to its Topic by the longest known prefix. */
function topicFor(path) {
  let best;
  for (const t of topicElement.keys())
    if (
      (path === t || path.startsWith(`${t}.`)) &&
      (!best || t.length > best.length)
    )
      best = t;
  return best && topicElement.get(best);
}
function domainFor(uId, path) {
  const domain = path.split(".")[0];
  return (
    domainElement.get(`${uId}|${domain}`) ??
    domainElement.get(`gonogo.mod.contract|${domain}`)
  );
}
for (const { uId, wId, w, commands } of widgetReads) {
  for (const cmd of commands) {
    const target = commandElement.get(cmd) ?? domainFor(uId, cmd);
    if (target) relate(wId, target, "sends", { kind: "command" });
    else
      warnings.push(`${wId} sends ${cmd}, which no command or domain matches`);
  }
  if (!w) continue;
  const reads = new Set([
    ...(w.channels ?? []),
    ...(w.optionalChannels ?? []),
    ...(w.dataRequirements ?? []),
  ]);
  const families = [
    ...(w.channelFamilies ?? []),
    ...(w.optionalChannelFamilies ?? []),
  ].map((f) => (typeof f === "string" ? f : (f.prefix ?? f.family ?? "")));
  const targets = new Set();
  for (const r of reads) {
    const t = topicFor(r) ?? domainFor(uId, r);
    if (t) targets.add(t);
    else warnings.push(`${w.id} reads ${r}, which no Topic or domain matches`);
  }
  for (const f of families.filter(Boolean)) {
    const d = domainFor(uId, f);
    if (d) targets.add(d);
  }
  for (const t of targets) relate(wId, t, "reads", { kind: "telemetry" });
}

for (const r of facts.relations) {
  for (const end of [r.from, r.to])
    if (!elements.has(end))
      throw new Error(`facts.mjs names ${end}, which the model does not have`);
  relate(r.from, r.to, r.title, r);
}
for (const r of relations)
  for (const end of [r.from, r.to])
    if (!elements.has(end))
      throw new Error(`relation to unknown element ${end}`);

const q = (s) =>
  `'${String(s ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\\/g, "")
    .replace(/'/g, "’")
    .replace(/\s+/g, " ")
    .trim()}'`;
const children = (id) =>
  [...elements.keys()].filter((k) => elements.get(k).parent === id);
const roots = [...elements.keys()].filter((k) => !elements.get(k).parent);

function writeElement(id, depth) {
  const e = elements.get(id);
  const pad = "  ".repeat(depth);
  const name = id.slice(id.lastIndexOf(".") + 1);
  const out = [`${pad}${name} = ${e.kind} ${q(e.title)} {`];
  for (const t of e.tags) out.push(`${pad}  #${t}`);
  if (e.technology) out.push(`${pad}  technology ${q(e.technology)}`);
  if (e.description) out.push(`${pad}  description ${q(e.description)}`);
  const meta = Object.entries(e.metadata ?? {}).filter(([, v]) => v);
  if (meta.length) {
    out.push(`${pad}  metadata {`);
    for (const [k, v] of meta) out.push(`${pad}    ${k} ${q(v)}`);
    out.push(`${pad}  }`);
  }
  for (const c of children(id)) out.push(...writeElement(c, depth + 1));
  out.push(`${pad}}`);
  return out;
}

const seen = new Set();
const relationLines = [];
for (const r of relations) {
  const key = `${r.from}|${r.to}|${r.kind}|${r.title}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const arrow = r.kind === "uses" ? "->" : `-[${r.kind}]->`;
  const body = r.technology ? ` {\n    technology ${q(r.technology)}\n  }` : "";
  relationLines.push(`  ${r.from} ${arrow} ${r.to} ${q(r.title)}${body}`);
}

/** Every element related to one of `ids` (or to a descendant of one). */
function neighbours(ids) {
  const inside = (x) => ids.some((i) => x === i || x.startsWith(`${i}.`));
  const out = new Set();
  for (const r of relations) {
    if (inside(r.from) && !inside(r.to)) out.add(r.to);
    if (inside(r.to) && !inside(r.from)) out.add(r.from);
  }
  return [...out];
}
const descendants = (id) =>
  [...elements.keys()].filter((k) => k.startsWith(`${id}.`));

const views = [];
const STYLE_OLD = "    style element.tag = #olderContract { color amber }";
const ancestorsOrSelf = (id) => {
  const out = [];
  for (let x = id; x; x = elements.get(x).parent) out.push(x);
  return out;
};
/**
 * LikeC4 draws several relationships between two boxes as one edge labelled
 * "[...]". For each such pair among `shown`, name the merged edge after the
 * relationships it stands for.
 */
function mergedEdges(shown, skipKinds = []) {
  const visible = new Set(shown);
  const pairs = new Map();
  for (const r of relations) {
    if (skipKinds.includes(r.kind)) continue;
    const a = ancestorsOrSelf(r.from).find((x) => visible.has(x));
    const b = ancestorsOrSelf(r.to).find((x) => visible.has(x));
    if (!a || !b || a === b) continue;
    const key = `${a} -> ${b}`;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key).add(r.title);
  }
  const out = [];
  for (const [key, titles] of pairs) {
    if (titles.size < 2) continue;
    const list = [...titles];
    const title =
      list.length > 3
        ? `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`
        : list.join(", ");
    out.push(`    include ${key} with {\n      title ${q(title)}\n    }`);
  }
  return out.join("\n");
}

const GLOSSARY =
  "Uplink: an add-on that brings one KSP mod to gonogo, with a C# half in the game and widgets in the app. " +
  "Topic: one named stream of readings, such as vessel.flight. " +
  "Domain: the Topics and commands that share a first name segment. " +
  "Sitrep: the code name of the Gonogo mod and its stream.";
views.push(`  view index {
    title 'Layer 1: system context'
    description ${q(`Who and what talks to gonogo. Click a box to open it. ${GLOSSARY}`)}
    include *
${mergedEdges(roots)}
  }`);

const containerShown = [
  ...children("gonogo").filter((c) => c !== "gonogo.devtools"),
  "operator",
  "crew",
  "author",
  "ksp",
  "uplinks",
  "broker",
  "stun",
  "cdn",
];
views.push(`  view containers of gonogo {
    title 'Layer 2: containers'
    description 'The running pieces of gonogo, and the published packages an Uplink builds against. Package imports are on the Packages view.'
    include ${containerShown.join(", ")}
    exclude * -> * where kind is imports
${mergedEdges(containerShown, ["imports"])}
  }`);

const packageShown = [
  ...children("gonogo.main"),
  "gonogo.sdk",
  "gonogo.uikit",
  "gonogo.uplinkTools",
  "gonogo.nuget",
  "gonogo.relay",
  ...children("gonogo.mod"),
  ...children("gonogo.devtools"),
];
views.push(`  view packages {
    title 'Packages and projects'
    description 'The workspace packages and the mod’s C# projects, with what each imports or references'
    include ${packageShown.join(", ")}
    exclude * -> * where kind is not imports
  }`);

const networkIds = [
  "gonogo.main.app.peer",
  "gonogo.main.app.telemetry",
  "gonogo.station.peer",
  "gonogo.relay.coturnManager",
  "gonogo.relay.turnRoutes",
  "gonogo.mod.transport",
  "broker",
  "stun",
];
views.push(`  view network {
    title 'Network: how stations reach the main screen'
    description 'Stations find the main screen through the public PeerJS broker. Public STUN at Google and Cloudflare opens a direct path, on the LAN or over the internet. When no direct path works, the traffic goes through the TURN server in the relay container.'
    include ${networkIds.join(", ")}
  }`);

/**
 * The boxes LikeC4 draws in a view of `id`: its children, and each element
 * related to one of them shown as its ancestor just below the deepest
 * ancestor it shares with `id`.
 */
function elementViewShown(id) {
  const shown = new Set(children(id));
  const mine = new Set(ancestorsOrSelf(id));
  for (const r of relations)
    for (const [a, b] of [
      [r.from, r.to],
      [r.to, r.from],
    ]) {
      if (!a.startsWith(`${id}.`) || b === id || b.startsWith(`${id}.`))
        continue;
      const path = ancestorsOrSelf(b);
      const i = path.findIndex((x) => mine.has(x));
      shown.add(i === -1 ? path[path.length - 1] : path[i - 1]);
    }
  return [...shown];
}

/** One view per element that has children, so every box can be opened. */
const LAYER = {
  container: "Layer 3: components",
  component: "Layer 3: components",
};
for (const id of [...elements.keys()]) {
  const e = elements.get(id);
  if (!children(id).length || id === "gonogo") continue;
  if (e.kind === "uplink" || id === "uplinks") continue;
  const prefix =
    e.kind === "domain"
      ? "Contract domain"
      : e.kind === "system" || e.kind === "external"
        ? "System"
        : (LAYER[e.kind] ?? e.kind);
  /*
   * The app shell's screens and shared components import nearly every other
   * module, so their import edges are left out to keep the rest readable.
   */
  const exclude =
    id === "gonogo.main.app"
      ? "\n    exclude gonogo.main.app.screens -> *, gonogo.main.app.components -> *"
      : "";
  views.push(`  view ${ident(`v_${id}`)} of ${id} {
    title ${q(`${prefix}: ${e.title}`)}
    include *${exclude}
${mergedEdges(elementViewShown(id))}
${STYLE_OLD}
  }`);
}
views.push(`  view uplinkLayer of uplinks {
    title 'Layer 4: Uplinks'
    description ${q(`Every Uplink and the KSP mod it wraps, with the contract and extension API it was built against on each box. Click an Uplink for its domains, Topics, commands and widgets. Amber: built against an older contract major than the current ${CONTRACT_MAJOR}.${CONTRACT_MINOR}.`)}
    include ${[
      ...children("uplinks"),
      ...children("ksp").filter((k) => k !== "ksp.stock"),
    ].join(", ")}
${STYLE_OLD}
    autoLayout LeftRight
  }`);
for (const u of children("uplinks")) {
  const inner = [u, ...descendants(u)];
  const near = neighbours([u]);
  const e = elements.get(u);
  views.push(`  view ${ident(`v_${u}`)} of ${u} {
    title ${q(`Uplink: ${e.title} (${e.technology})`)}
    description ${q(e.description)}
    include ${[...inner, ...near].join(",\n      ")}
${STYLE_OLD}
  }`);
}

const spec = `specification {
  element person {
    notation 'Person'
    style { shape person; color green }
  }
  element system {
    notation 'Software system'
    style { color primary }
  }
  element external {
    notation 'Outside system or service'
    style { color gray }
  }
  element externalPart {
    notation 'Part of an outside system'
    style { color gray }
  }
  element container {
    notation 'Container'
    style { color blue }
  }
  element library {
    notation 'Published package'
    style { color sky; shape component }
  }
  element component {
    notation 'Component'
    style { color secondary }
  }
  element uplink {
    notation 'Uplink'
    style { color indigo }
  }
  element domain {
    notation 'Contract domain: a Topic namespace'
    style { color muted }
  }
  element topic {
    notation 'Topic'
    style { color slate; shape storage }
  }
  element command {
    notation 'Command'
    style { color red; shape queue }
  }
  element widget {
    notation 'Widget'
    style { color green; shape browser }
  }
  relationship telemetry {
    notation 'Telemetry'
    color green
  }
  relationship command {
    notation 'Commands'
    color amber
  }
  relationship signalling {
    notation 'Signalling'
    color sky
    line dashed
  }
  relationship imports {
    notation 'Imports or references'
    color gray
    line dotted
  }
  relationship relayed {
    notation 'Relayed path'
    color red
    line dotted
  }
  tag olderContract
  tag noClient
}
`;

const banner = `// Generated by scripts/c4/generate.mjs. Edit the script or facts.mjs, never this file.\n`;
rmSync(MODEL_DIR, { recursive: true, force: true });
mkdirSync(MODEL_DIR, { recursive: true });
writeFileSync(
  join(MODEL_DIR, "gonogo.c4"),
  `${banner}${spec}
model {
${roots.flatMap((r) => writeElement(r, 1)).join("\n")}

${relationLines.join("\n")}
}

views {
${views.join("\n\n")}
}
`,
);
writeFileSync(
  join(MODEL_DIR, "likec4.config.json"),
  `${JSON.stringify({ name: "gonogo", title: "gonogo architecture" }, null, 2)}\n`,
);

for (const w of warnings) console.warn(`warning: ${w}`);
console.log(
  `model: ${elements.size} elements, ${seen.size} relationships, ${views.length} views, ${uplinkList.length} Uplinks`,
);
console.log(`model written to ${relative(ROOT, MODEL_DIR)}`);

function likec4(...rest) {
  const r = spawnSync("npx", ["-y", LIKEC4, ...rest], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (flag("--model-only")) process.exit(0);
if (flag("--serve")) {
  likec4("start", MODEL_DIR);
  process.exit(0);
}
likec4("validate", MODEL_DIR);
likec4(
  "build",
  MODEL_DIR,
  "-o",
  SITE_DIR,
  "--base",
  "./",
  "--use-hash-history",
  "--title",
  "gonogo",
);
console.log(`site built in ${SITE_DIR}; view it with: npx serve ${SITE_DIR}`);
if (PNG_DIR) {
  likec4("export", "png", MODEL_DIR, "-o", PNG_DIR, "--flat", "-i");
  console.log(`PNGs exported to ${PNG_DIR}`);
}
