// Can every type that reaches the wire actually BE written?
//
// `JsonWriter.AppendValue` dispatches on runtime type and throws
// `NotSupportedException` for anything it has no case for. `EnvelopeCodec`
// catches that and fail-softs, so the frame is dropped and the client sits on
// "subscribed" forever with nothing red anywhere. It has now happened five
// times: `CommandResult`, `CommsDelay`, an uplink's own boxed enum,
// `commandCentre.roster`'s entry, and `vessel.repair`'s reply payload.
//
// ## Why this is not the C# gate that already exists
//
// `mod/Sitrep.Core.Tests/WirePayloadCoverageTests.cs` reflects over every
// `[SitrepContract]` class and serialises a DEFAULT instance of each. It is a
// good gate and it missed two of the five, because both were sitting on its
// `FlattenedByProducer` allowlist: an entry there is a human CLAIM about what a
// producer does, and reflection cannot grade a claim. The roster's entry was
// recorded as "hand-flattened by its producer" when nothing flattens it, and the
// repair outcome as "rides out inside a flattened reply" when
// `CommandResult<T>.Payload` goes straight back through `AppendValue`.
//
// So this gate takes its inventory and its verdicts from somewhere else:
//
//   * the INVENTORY is the generated channel map (`GeneratedTopicPayloadMap` and
//     `GeneratedCommandReplyMap`), walked TRANSITIVELY through the contract's own
//     field types. That is the set of types that can reach the wire, read off the
//     same model `scripts/asyncapi-doc.mjs` builds the published document from,
//     rather than off "every class carrying an attribute".
//   * the VERDICTS are derived from the mod sources, not declared. There is no
//     allowlist here to put a claim in.
//
// ## Every generated slice, not just the core one
//
// An Uplink owns its wire types: they live in its own `<Uplink>.Contract` project
// and generate their own `contract.ts` and channel maps under
// `mod/<Uplink>/client/src/__generated__`. The third instance of this bug class
// was an Uplink publishing one of its OWN enums, so a walk that reads only the
// core slice cannot see the shape its own history is about. Every slice is
// walked, and the Uplink list is DISCOVERED through `uplink-matrix.mjs` rather
// than written down here: `contractSlices` has the reasoning, and a floor.
//
// An Uplink-owned type can never be `written`. `JsonWriter` is in `Sitrep.Core`
// and a core serializer may not reference an Uplink assembly, so every case it
// has names `Sitrep.Contract.*`. Flattening in the producer before `Publish` is
// the only route open to one, which is exactly what `RaWire` and
// `KosProcessorInfoBuilder` do.
//
// ## The limit that remains: a DYNAMIC channel's payload
//
// The inventory is the STATIC map, and `topic-map.ts`'s own header says at
// length that it is not a list of every topic on the wire. A namespace
// registered through `IUplinkHost.RegisterDynamicNamespace` materialises its
// topics per subject, carries no `[SitrepTopic]` tag for reflection to find, and
// so appears in no generated map. 46 declared contract types are published on no
// static channel and are no command's args, 16 of them Uplink-owned, and
// `kos.run.<coreId>` / `kos.terminal.<coreId>` are the live examples: real
// published payloads this walk does not grade. They are flattened today, and
// nothing here would notice if they stopped being.
//
// Command ARGS are deliberately not roots: they travel client-to-server and are
// only ever deserialised. Replies are, because they are written.
//
// ## The three ways a type is allowed to have no case
//
// 1. `JsonWriter` can write it: it has a `case`, or a hand-written
//    `Append<Type>` helper that a sibling flattener calls for a nested value.
// 2. Nothing constructs it. A type no production source ever `new`s cannot be
//    handed to `AppendValue`, whatever its shape says. Most of the contract is
//    like this: the POCO exists so codegen has a TS interface to emit, and the
//    producer hand-builds the dictionary.
// 3. A producer flattens it: some production source declares a method returning
//    `Dictionary<string, object?>` that takes the type, or is named for it.
//
// Anything else is a type a producer builds, nobody flattens, and the writer
// cannot write. That is the bug, and it is the whole finding.
//
// ## The scan is regex over C#, and regexes go quiet
//
// `scanCSharp` is the fragile half, so it is a pure function over
// `[{ path, text }]` and its caller plants a synthetic violation of every arm
// through it on every run (see `selfCheck`). A pattern that stops matching then
// fails as BLIND rather than reporting a clean tree, which is the failure mode
// this repo keeps meeting.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readContract, readMapInterface } from "./asyncapi/contract-model.mjs";
import { SOURCES } from "./asyncapi/sources.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const JSON_WRITER = "mod/Sitrep.Core/Serialization/JsonWriter.cs";

/**
 * Generated interface name -> the C# type it was emitted from, where the two
 * differ.
 *
 * ONE entry, and it is the only shape in the contract that needs it: a C#
 * generic emits as `Name` + `Of`, so `CommandResult<T>` reaches the generated
 * map as `CommandResultOf` while `JsonWriter`'s case names `CommandResult`.
 * Kept as data rather than as an "ends with Of" rule, because a contract type
 * legitimately named `...Of` would then be silently renamed into something that
 * does not exist.
 */
const GENERATED_NAME_TO_CSHARP = { CommandResultOf: "CommandResult" };

/**
 * Types reachable in the walk that are not contract POCOs at all.
 *
 * `ProviderExtensions` is a hand-written `Record<string, ...>` alias in the SDK,
 * not a generated interface: on the C# side it is an
 * `IDictionary<string, object?>` and `AppendProviderExtensions` writes it
 * through `AppendObject`. It has no C# class to look for and never could.
 */
const NOT_A_POCO = new Set(["ProviderExtensions"]);

/** Every type name a parsed field type mentions, generic arguments included. */
export function referencedTypes(type, into = []) {
  if (!type) return into;
  if (type.k === "ref") {
    into.push(type.name);
    for (const arg of type.args ?? []) referencedTypes(arg, into);
  } else if (type.k === "array" || type.k === "map") {
    referencedTypes(type.of, into);
  }
  return into;
}

/**
 * Every type reachable from a published payload, and one path that reaches it.
 *
 * Transitive, which is the half the default-instance sweep in C# cannot do: an
 * empty `List<CommandCentreEntry>` serialises to `[]` without its element type
 * ever reaching the payload switch, so a nested type is only exercised there
 * when someone remembers to populate the instance.
 */
export function reachableFromChannels({ contract, roots }) {
  const reached = new Map();
  const queue = [];
  const see = (name, via, root) => {
    if (!reached.has(name)) {
      reached.set(name, { via, root });
      queue.push(name);
    } else if (root) {
      reached.get(name).root = true;
    }
  };

  for (const { key, type } of roots) {
    for (const name of referencedTypes(type)) see(name, key, true);
  }

  while (queue.length > 0) {
    const name = queue.shift();
    const iface = contract.interfaces.get(name);
    if (!iface) continue;
    const parameters = new Set(iface.typeParameters ?? []);
    for (const base of iface.extends ?? []) see(base, `${name} extends`, false);
    for (const field of iface.fields) {
      for (const referenced of referencedTypes(field.type)) {
        // `payload?: T` on the generic result interface names a type
        // PARAMETER, not a type. The concrete argument reaches the walk from
        // the channel map entry that binds it.
        if (parameters.has(referenced)) continue;
        see(referenced, `${name}.${field.name}`, false);
      }
    }
  }
  return reached;
}

/**
 * The type names `JsonWriter` can write, in the two spellings that mean
 * different things.
 *
 * `switched` is the payload switch's own `case Sitrep.Contract.X x:`. That is
 * the only thing that helps a value handed to `AppendValue`, which is what a
 * CHANNEL ROOT always is: the publisher hands the payload over and the switch
 * is what meets it.
 *
 * `helpers` additionally counts `AppendX(StringBuilder sb, Sitrep.Contract.X x)`,
 * a hand-written flattener a SIBLING calls directly for a nested value.
 * `PayloadMeta` is the shape of this: it has no case and needs none, because
 * every payload carrying one writes it through `AppendPayloadMeta` without the
 * switch ever seeing it. Whether such a helper writes every field of its type is
 * a different question, and `JsonWriterFlattenerParityTests` is the gate for it.
 *
 * The distinction is load-bearing. Counting a helper as coverage for a root
 * masks a missing case exactly: deleting the roster's `case` while leaving
 * `AppendCommandCentreEntry` in place left this gate green, which is the same
 * blindness in a new place.
 */
export function writableTypes(jsonWriterSource) {
  const switched = new Set();
  for (const match of jsonWriterSource.matchAll(
    /case\s+Sitrep\.Contract\.([A-Za-z0-9_]+)\s+[A-Za-z0-9_]+\s*:/g,
  )) {
    switched.add(match[1]);
  }
  const helpers = new Set(switched);
  for (const match of jsonWriterSource.matchAll(
    /Append[A-Za-z0-9_]*\(\s*StringBuilder\s+\w+,\s*Sitrep\.Contract\.([A-Za-z0-9_]+)\??\s+\w+\s*\)/g,
  )) {
    helpers.add(match[1]);
  }
  return { switched, helpers };
}

/**
 * What the mod's own sources say about each type: who builds one, and who
 * flattens one.
 *
 * A pure function over file contents so the caller can run a planted violation
 * through the identical code path.
 */
export function scanCSharp(files) {
  const constructed = new Map();
  const flattened = new Map();
  const build = (name, path) => {
    if (name && !constructed.has(name)) constructed.set(name, path);
  };
  for (const { path, text } of files) {
    for (const match of text.matchAll(
      /\bnew\s+([A-Z][A-Za-z0-9_]*)\s*[({\r\n]/g,
    )) {
      build(match[1], path);
    }
    // The TARGET-TYPED form, where the type is on the left: `public CommsDelay
    // Delay = new();`. Not a nicety. `CommsDelay` is the second instance this
    // bug class ever had, and it is built nowhere else in production, so a scan
    // reading only `new T` cannot see the type its own history is about.
    for (const match of text.matchAll(
      /\b([A-Z][A-Za-z0-9_]*)\??\s+[A-Za-z_]\w*\s*=\s*new\s*[({]/g,
    )) {
      build(match[1], path);
    }
    const owners = [
      ...text.matchAll(/\b(?:class|struct|record)\s+([A-Za-z0-9_]+)/g),
    ].map((match) => ({ at: match.index, name: match[1] }));
    /*
     * A flattener returns the untyped dictionary `AppendObject` walks, or a
     * collection of them when the channel is an array. It says which type it is
     * for in one of three ways, and the mod uses all three:
     *
     *   the PARAMETER, `ToWire(VesselOrbit orbit)`;
     *   the METHOD NAME, `BuildControlFrame(Kernel? kernel)`, which reads the
     *     elected source rather than being handed the value;
     *   the ENCLOSING CLASS, `KosProcessorInfoBuilder.Build(int coreId, ...)`,
     *     whose parameters are all primitives and whose method is just `Build`.
     */
    for (const match of text.matchAll(FLATTENER)) {
      const [, method, firstParameter] = match;
      const owner = owners.filter((entry) => entry.at < match.index).pop();
      const subjects = [
        ...parameterSubjects(firstParameter),
        ...methodNameSubjects(method),
        ...(owner ? ownerNameSubjects(owner.name) : []),
      ];
      for (const candidate of subjects) {
        if (candidate && !flattened.has(candidate))
          flattened.set(candidate, path);
      }
    }
  }
  return { constructed, flattened };
}

/**
 * A method returning the wire dictionary, or one collection layer of them.
 *
 * The wrapped form is not a nicety: an array channel's producer returns
 * `List<Dictionary<string, object?>>`, and reading only the bare form left
 * `realantennas.hopRates` looking uncovered while `RaWire.HopRates` was
 * flattening it all along.
 *
 * The wrapper and the bare form are ALTERNATIVES rather than an optional prefix
 * and an optional `>`, which is not a stylistic choice. Written the loose way,
 * the bare arm matches the inner `Dictionary<string, object?>` of
 * `CommandResult<Dictionary<string, object?>> NewComplex(...)` and the stray `>`
 * is swallowed by the optional one, so nine Rp1 command handlers were read as
 * flatteners for `CommandResult` and deleting its `JsonWriter` case stopped
 * failing. Measured against the pre-existing plant table, not reasoned about.
 *
 * The first parameter is captured up to the first `,` or `)`, so a parameter
 * whose own type carries a comma (`Dictionary<string, X> map`) contributes only
 * its head. No flattener in the tree takes one, and the method name and the
 * enclosing class still speak for it if one ever does.
 */
const FLATTENER = new RegExp(
  "(?:" +
    "(?:List|IList|IReadOnlyList|ICollection|IReadOnlyCollection|IEnumerable)" +
    "\\s*<\\s*I?Dictionary<string,\\s*object\\??>\\s*>" +
    "|I?Dictionary<string,\\s*object\\??>" +
    ")\\??\\s+([A-Za-z0-9_]+)\\s*\\(\\s*(?:this\\s+)?([^,)]*)",
  "g",
);

/**
 * The types a flattener's first parameter mentions, generic arguments included.
 *
 * The parameter NAME is dropped first, so `ToWire(VesselOrbit orbit)` claims
 * `VesselOrbit` and not whatever `orbit` might collide with, and only
 * capitalised identifiers survive, so `int coreId` claims nothing.
 */
function parameterSubjects(parameter) {
  if (!parameter) return [];
  const type = parameter.trim().replace(/\s+[A-Za-z_]\w*$/, "");
  return [...type.matchAll(/[A-Z][A-Za-z0-9_]*/g)].map((match) => match[0]);
}

/**
 * The type a flattener's enclosing class claims as its subject:
 * `KosProcessorInfoBuilder` -> `KosProcessorInfo`.
 *
 * The BARE class name is deliberately not a subject. A class named exactly
 * after a contract type is the POCO or its provider, not a flattener for it,
 * and counting it would let any dictionary-returning member of such a class
 * vouch for the type it is named after.
 */
function ownerNameSubjects(name) {
  const subjects = [];
  for (const suffix of ["Builder", "Wire", "Writer", "Flattener"]) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      subjects.push(name.slice(0, -suffix.length));
    }
  }
  return subjects;
}

/**
 * The type a flattener's NAME claims as its subject: `BuildControlFrame` ->
 * `ControlFrame`, `ToWireVesselParts` -> `VesselParts`.
 *
 * Only the verb prefixes the mod actually uses are stripped, and the result is
 * only ever consulted for a name that is already a known contract type, so a
 * coincidence has to collide with a real declared type to matter.
 */
function methodNameSubjects(method) {
  const subjects = [method];
  for (const prefix of ["ToWire", "Build", "Write", "Flatten", "Wire"]) {
    if (method.startsWith(prefix) && method.length > prefix.length) {
      subjects.push(method.slice(prefix.length));
    }
  }
  return subjects;
}

/**
 * One type's verdict: how it reaches the wire, or that it cannot.
 *
 * `root` says the type is a channel's payload (or an element of one), so it is
 * handed to `AppendValue` directly and only a `case` will do.
 *
 * `sliceOwned` says the type is declared by an Uplink's own contract slice.
 * `JsonWriter` lives in `Sitrep.Core` and a core serializer may not reference an
 * Uplink's assembly, so every case it has names `Sitrep.Contract.*` and none of
 * them can ever meet an Uplink-owned type, whatever it happens to be called.
 * Flattening in the producer before `Publish` is the only route open to one, and
 * it is the route every Uplink-owned payload already takes.
 */
export function classify(
  name,
  { writable, constructed, flattened, root, sliceOwned },
) {
  const csharp = GENERATED_NAME_TO_CSHARP[name] ?? name;
  const written = sliceOwned
    ? new Set()
    : root
      ? writable.switched
      : writable.helpers;
  if (written.has(csharp)) return { verdict: "written", detail: JSON_WRITER };
  if (!constructed.has(csharp)) return { verdict: "never-built", detail: "" };
  if (flattened.has(csharp)) {
    return { verdict: "producer-flattened", detail: flattened.get(csharp) };
  }
  return { verdict: "uncovered", detail: constructed.get(csharp) };
}

/**
 * The mod's production C#: everything tracked under `mod/`, minus the test
 * projects.
 *
 * A type built only by a test is not built by a producer, and counting one
 * would let a test fixture vouch for a type nothing publishes.
 */
export function productionSources(root = REPO_ROOT) {
  // Tracked AND untracked-but-not-ignored, because `git ls-files` alone reads
  // the index: a producer added in the working tree and not yet staged is
  // invisible to it, and the gate reads green over the very file that
  // introduces the bug. Measured, not assumed: the planted violation that
  // validated this gate passed for exactly that reason on its first run.
  const listed = [
    ...execFileSync("git", ["ls-files", "mod"], {
      cwd: root,
      encoding: "utf8",
    }).split("\n"),
    ...execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "mod"],
      {
        cwd: root,
        encoding: "utf8",
      },
    ).split("\n"),
  ]
    .filter((path) => path.endsWith(".cs"))
    // Any project directory ENDING in Tests, not just `.Tests`:
    // `Sitrep.Host.IntegrationTests` is one, and it slipped through the narrower
    // spelling long enough to vouch for a type production builds nowhere.
    // `GonogoTestFlightUplink` is production and correctly survives, TestFlight
    // being the name of a KSP mod.
    .filter((path) => !/(^|\/)[A-Za-z0-9._]*Tests\//.test(path))
    .filter((path) => !/Tests?\.cs$/.test(path))
    .filter((path) => !/TestSupport/.test(path));
  if (listed.length === 0) {
    throw new Error(
      "wire-payload-coverage: git ls-files matched no C# under mod/. The scan " +
        "would report a clean tree over nothing.",
    );
  }
  return listed.map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
}

/**
 * Planted violations, run through the real `scanCSharp` and `classify` on every
 * invocation.
 *
 * A regex that has stopped matching reports zero, and zero reads as success.
 * Each arm of the verdict is planted here so the gate fails as BLIND instead.
 */
export function selfCheck() {
  const planted = scanCSharp([
    {
      path: "planted/Producer.cs",
      text: [
        "public static PlantedUncovered Build() => new PlantedUncovered",
        "{",
        '    Id = "x",',
        "};",
        "public static PlantedFlattened Make() => new PlantedFlattened();",
        "private static Dictionary<string, object?> ToWire(PlantedFlattened p) =>",
        "    new Dictionary<string, object?>();",
        "public static PlantedNamedFlatten Other() => new PlantedNamedFlatten();",
        "internal static Dictionary<string, object?>? BuildPlantedNamedFlatten(Kernel? k) =>",
        "    null;",
        "public static PlantedNested Nested() => new PlantedNested();",
        "public PlantedTargetTyped Value = new();",
        "public static PlantedListFlattened Listed() => new PlantedListFlattened();",
        "internal static List<Dictionary<string, object?>> Rates(",
        "    IReadOnlyList<PlantedListFlattened> rows) => null;",
        "public static PlantedOwnerFlattened Owned() => new PlantedOwnerFlattened();",
        "public static PlantedSliceOwned Slice() => new PlantedSliceOwned();",
        "public static PlantedGenericArgument Generic() => new PlantedGenericArgument();",
        "public PlantedGenericArgument<Dictionary<string, object?>> Handle(int id) => null;",
      ].join("\n"),
    },
    {
      /*
       * Its own file, because the subject is the ENCLOSING CLASS and the scan
       * resolves that by position: a second declaration in the producer above
       * would make this arm pass for the wrong reason.
       */
      path: "planted/PlantedOwnerFlattenedBuilder.cs",
      text: [
        "public static class PlantedOwnerFlattenedBuilder",
        "{",
        "    public static Dictionary<string, object?> Build(int id) =>",
        "        new Dictionary<string, object?>();",
        "}",
      ].join("\n"),
    },
  ]);
  const writable = writableTypes(
    "case Sitrep.Contract.PlantedWritten written:\n" +
      "case Sitrep.Contract.PlantedSliceOwned slice:\n" +
      "private static void AppendPlantedNested(StringBuilder sb, Sitrep.Contract.PlantedNested n)\n",
  );
  const problems = [];
  const expect = (name, root, wanted, sliceOwned = false) => {
    const actual = classify(name, {
      writable,
      constructed: planted.constructed,
      flattened: planted.flattened,
      root,
      sliceOwned,
    }).verdict;
    if (actual !== wanted) {
      problems.push(
        `planted ${name} (${root ? "root" : "nested"}${sliceOwned ? ", slice-owned" : ""}): ` +
          `expected ${wanted}, the scan said ${actual}`,
      );
    }
  };
  expect("PlantedUncovered", true, "uncovered");
  expect("PlantedFlattened", true, "producer-flattened");
  expect("PlantedNamedFlatten", true, "producer-flattened");
  expect("PlantedWritten", true, "written");
  expect("PlantedNested", false, "written");
  // The distinction the root flag exists for: a helper is not a case, so the
  // same type read as a root is NOT covered. This arm went green while the
  // roster's case was deleted, which is what put it here.
  expect("PlantedNested", true, "uncovered");
  // The target-typed `T x = new()` form, which is how `CommsDelay` is built and
  // the only way the scan can see it at all.
  expect("PlantedTargetTyped", true, "uncovered");
  expect("PlantedAbsent", true, "never-built");
  // An ARRAY channel's producer returns a collection of dictionaries rather
  // than one, and it names its element type only in a generic argument. Reading
  // the bare return type alone left `realantennas.hopRates` reading uncovered
  // with `RaWire.HopRates` flattening it in plain sight.
  expect("PlantedListFlattened", true, "producer-flattened");
  /*
   * The subject carried by the enclosing CLASS, which is how the scripting
   * Uplink flattens its processor listing: every parameter of
   * `KosProcessorInfoBuilder.Build` is a primitive and the method is named
   * `Build`, so neither of the other two arms can see it.
   */
  expect("PlantedOwnerFlattened", true, "producer-flattened");
  // A `case Sitrep.Contract.X` cannot write an Uplink's own `X`: the runtime
  // types differ and a core serializer may not reference the Uplink assembly.
  // Planted with the case PRESENT, so the arm fails if slice ownership stops
  // being honoured rather than if the case disappears.
  expect("PlantedSliceOwned", true, "written");
  expect("PlantedSliceOwned", true, "uncovered", true);
  // The wire dictionary as somebody else's GENERIC ARGUMENT is not a flattener
  // for anything. `CommandResult<Dictionary<string, object?>>` is nine Rp1
  // command handlers' return type, and reading the wrapper loosely enough to
  // accept `List<...>` also accepted this and made `CommandResult` itself look
  // flattened, which silently un-planted an entry of the original table.
  expect("PlantedGenericArgument", true, "uncovered");
  return problems;
}

/**
 * A floor on the Uplink slices the walk finds, not an equality.
 *
 * A discovery that matches nothing hashes nothing and reports a clean tree, and
 * that reads as success. Set below the six slices on disk today so removing an
 * Uplink does not trip it, and far enough above zero that a broken walk does.
 * Same reasoning, and the same shape, as `uplink-matrix.mjs`'s own FLOOR.
 */
const UPLINK_SLICE_FLOOR = 5;

/**
 * The generated slices to walk: the core contract, plus every Uplink that owns
 * one.
 *
 * The Uplink list is DISCOVERED, through `uplink-matrix.mjs`, the same way the
 * CI matrix and five other gates get it. A list written here would be a
 * twelfth hand-maintained roster with no gate on its own completeness, which is
 * the failure that script exists to end; it also already refuses to emit a short
 * matrix, so a broken walk fails there before it reaches this.
 *
 * The Uplinks are ragged: three own no contract slice at all, and of the nine
 * that do, one is command-only and has no topic map. Absent maps are skipped and
 * a present one is REQUIRED to parse, so a slice that stops being readable fails
 * rather than quietly contributing nothing.
 */
export function contractSlices(repoRoot = REPO_ROOT) {
  const slices = [
    {
      id: "Sitrep.Contract",
      core: true,
      contract: SOURCES.contract,
      maps: [
        [SOURCES.topicMap, "GeneratedTopicPayloadMap"],
        [SOURCES.commandMap, "GeneratedCommandReplyMap"],
      ],
    },
  ];
  const legs = JSON.parse(
    execFileSync("node", [join(repoRoot, "scripts/uplink-matrix.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  for (const leg of legs.filter((entry) => entry.generated)) {
    const generated = `mod/${leg.id}/client/src/__generated__`;
    slices.push({
      id: leg.id,
      core: false,
      contract: `${generated}/contract.ts`,
      maps: [
        [`${generated}/topic-map.ts`, "GeneratedTopicPayloadMap"],
        [`${generated}/command-map.ts`, "GeneratedCommandReplyMap"],
      ].filter(([path]) => existsSync(join(repoRoot, path))),
    });
  }
  const uplinks = slices.length - 1;
  if (uplinks < UPLINK_SLICE_FLOOR) {
    throw new Error(
      `wire-payload-coverage: found only ${uplinks} Uplink contract slice(s), ` +
        `fewer than this repo has ever had (${UPLINK_SLICE_FLOOR}). An Uplink's own ` +
        "payload types would go unwalked and the gate would report a clean tree " +
        "over them.",
    );
  }
  return slices;
}

/**
 * One slice's payload types, with a verdict each.
 *
 * An Uplink slice's `contract.ts` declares only the types that Uplink owns and
 * IMPORTS the rest from the SDK (`Value`, `PayloadMeta`, `CommandResult`), so
 * the walk reads against the core contract underneath its own. Which half a type
 * came from is the `sliceOwned` flag, and it decides whether `JsonWriter` can
 * possibly write it.
 */
function coverSlice({ slice, core, own, writable, constructed, flattened }) {
  const interfaces = new Map([...core.interfaces, ...own.interfaces]);
  const enums = new Map([...core.enums, ...own.enums]);
  const roots = slice.maps.flatMap(([path, name]) =>
    readMapInterface(join(REPO_ROOT, path), name),
  );
  const reached = reachableFromChannels({ contract: { interfaces }, roots });
  const verdicts = [];
  for (const [name, { via, root }] of reached) {
    if (enums.has(name)) {
      verdicts.push({ slice: slice.id, name, via, root, verdict: "enum" });
      continue;
    }
    if (NOT_A_POCO.has(name)) continue;
    verdicts.push({
      slice: slice.id,
      name,
      via,
      root,
      ...classify(name, {
        writable,
        constructed,
        flattened,
        root,
        sliceOwned: own.interfaces.has(name),
      }),
    });
  }
  return { roots: roots.length, reached: reached.size, verdicts };
}

/** Every reachable payload type, in every generated slice, with its verdict. */
export function checkWirePayloadCoverage(repoRoot = REPO_ROOT) {
  const core = readContract(join(repoRoot, SOURCES.contract));
  const writerSource = readFileSync(join(repoRoot, JSON_WRITER), "utf8");
  const writable = writableTypes(writerSource);
  const files = productionSources(repoRoot);
  const { constructed, flattened } = scanCSharp(files);

  // An enum reaches the writer BOXED, so its runtime type is the enum type and
  // it matches no numeric case: it needs `case System.Enum`, which is one case
  // covering every enum there will ever be. The third instance of this bug class
  // was exactly that, an Uplink publishing one of its OWN enums, which is why the
  // walk has to reach an Uplink's contract slice before it can name the type
  // that broke. Asserted rather than assumed, because an enum root would
  // otherwise be skipped in silence.
  const boxedEnums = /case\s+System\.Enum\s+\w+\s*:/.test(writerSource);

  const slices = [];
  const verdicts = [];
  for (const slice of contractSlices(repoRoot)) {
    const own = slice.core
      ? { interfaces: new Map(), enums: new Map() }
      : readContract(join(repoRoot, slice.contract));
    const walked = coverSlice({
      slice,
      core,
      own,
      writable,
      constructed,
      flattened,
    });
    for (const entry of walked.verdicts) {
      if (entry.verdict !== "enum") {
        verdicts.push(entry);
        continue;
      }
      if (boxedEnums) continue;
      verdicts.push({
        ...entry,
        verdict: "uncovered",
        detail: `no \`case System.Enum\` in ${JSON_WRITER}`,
      });
    }
    slices.push({
      id: slice.id,
      core: slice.core,
      roots: walked.roots,
      reached: walked.reached,
    });
  }

  const uplinkReached = slices
    .filter((slice) => !slice.core)
    .reduce((total, slice) => total + slice.reached, 0);
  if (uplinkReached === 0) {
    throw new Error(
      "wire-payload-coverage: the Uplink slices reached no payload types at " +
        "all. Nine slices publish between one and fifty-four channel roots, so " +
        "a zero here is a broken walk rather than a small tree, and it would " +
        "report clean over every Uplink-owned payload.",
    );
  }

  const of = (id) => slices.find((slice) => slice.id === id);
  return {
    roots: of("Sitrep.Contract").roots,
    reached: of("Sitrep.Contract").reached,
    writable: writable.switched.size,
    files: files.length,
    slices,
    uplinkSlices: slices.length - 1,
    uplinkRoots: slices
      .filter((slice) => !slice.core)
      .reduce((total, slice) => total + slice.roots, 0),
    uplinkReached,
    verdicts,
    uncovered: verdicts.filter((v) => v.verdict === "uncovered"),
    selfCheckProblems: selfCheck(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = checkWirePayloadCoverage();
  const tally = (entries) => {
    const counts = {};
    for (const { verdict } of entries)
      counts[verdict] = (counts[verdict] ?? 0) + 1;
    return JSON.stringify(counts);
  };
  console.log(
    `wire-payload-coverage: core ${report.roots} channel roots, ${report.reached} types reached, ` +
      `${report.writable} JsonWriter types, ${report.files} production sources`,
  );
  console.log(
    `  core ${tally(report.verdicts.filter((v) => v.slice === "Sitrep.Contract"))}`,
  );
  console.log(
    `  ${report.uplinkSlices} Uplink slices, ${report.uplinkRoots} channel roots, ` +
      `${report.uplinkReached} types reached`,
  );
  console.log(
    `  uplink ${tally(report.verdicts.filter((v) => v.slice !== "Sitrep.Contract"))}`,
  );
  for (const problem of report.selfCheckProblems)
    console.log(`  BLIND: ${problem}`);
  for (const { slice, name, via, detail } of report.uncovered) {
    console.log(
      `  UNCOVERED ${name} (${slice}, reached via ${via}, built in ${detail})`,
    );
  }
  const failed =
    report.uncovered.length > 0 || report.selfCheckProblems.length > 0;
  console.log(failed ? "FAIL" : "OK");
  process.exit(failed ? 1 : 0);
}
