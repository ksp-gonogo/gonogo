// The gate behind the `<internal>` convention: maintainer rationale that reached
// the published surface anyway.
//
// ## What the convention is
//
// A contract doc comment is one text with two audiences. A client author needs
// WHAT the value is; a maintainer needs WHY it is that way. Both belong beside
// the type in the C#. Only the first belongs on the published surface, and until
// now all of it went: 26% of the document's prose is the second kind, and the
// longest descriptions are long BECAUSE of it.
//
// So a summary marks its second half:
//
//   /// <summary>
//   /// One stage of the active vessel's stock ΔV simulation. Every field is
//   /// null whenever the raw value is absent or non-finite.
//   /// <internal>
//   /// Typing-only mirror of what StageDeltaVViewProvider.BuildStages already
//   /// emits; the wire is written by JsonWriter walking the provider's dict.
//   /// </internal>
//   /// </summary>
//
// `RtDocText` drops the `<internal>` subtree on the way to TSDoc, so it never
// reaches `contract.ts`, and therefore never reaches this document either.
//
// ## Why this file exists
//
// A convention nobody follows is worse than none. Nothing about forgetting the
// marker is visible: the prose ships, the document validates, the build is
// green, and the only symptom is a reader wading through an implementation note.
// This turns that into a build failure.
//
// It reads the CONTRACT MODEL rather than the emitted document, on purpose:
//
//   - it names the C# type the author has to go and fix, not `channels.dv.stages`
//   - a channel and its payload schema carry the SAME prose, so the document
//     double-counts every offence and would report each fix twice
//   - the generator's own hand-written prose (the `info` block explains that the
//     document is generated FROM `contract.ts`) is client-facing and correct,
//     and a detector pointed at the document flags it
//
// ## The detector is heuristic and the debt list is not
//
// Five families, each a phrase family that only a maintainer writes. They will
// miss rationale phrased without any of them, and they will occasionally catch a
// client-relevant sentence. That is why the list below is a RATCHET seeded with
// the measured state rather than a rule applied to a clean tree: the count may
// only fall. A false positive is rewritten or, if it is genuinely client prose
// that happens to name a producer, kept in the list with a comment saying so.
//
// A regex that matches nothing reports zero, and zero reads as success. This
// repo has shipped that failure more than once, so `assertDetectorSees` plants a
// positive for every family and fails as BLIND if any of them cannot see it.

/**
 * The phrase families that mark prose as written for a maintainer.
 *
 * Each carries the count it was seeded at, so a family that quietly stops
 * matching is visible as a number rather than as an absence.
 */
export const FAMILIES = {
  /** Producer types live in unpublished assemblies; naming one points a reader nowhere. */
  "producer-type": {
    pattern: /\b(?:Sitrep\.Host|Sitrep\.Core|Gonogo\.KSP)[.\w]*/g,
    plant: "filled by Sitrep.Host.CareerViewProvider each tick",
  },
  /** How the type relates to the serializer, which is not a property of the wire. */
  "typing-only": {
    pattern:
      /\b(?:typing-only(?: mirror)?|TS-shape-only|not serial(?:ized|ised) itself|never serial(?:izes|ises|ized|ised))\b/gi,
    // Deliberately WRAPPED mid-phrase. Every one of these patterns is multi-word
    // and the prose it runs against is re-wrapped at 76 columns, so a plant
    // written on one line proves the pattern against input the tree never
    // actually produces.
    plant:
      "**Typing-only mirror.** It is never\nserialized, it only names the shape.",
  },
  /** The generation pipeline: an artifact of how the SDK is built, not of the contract. */
  codegen: {
    pattern:
      /\b(?:RtConfig(?:\.\w+)?|codegen|contract\.ts|units\.json|reckonability\.ts|JsonWriter|TsInterface|SitrepCommandAttribute|SitrepTopicAttribute|SitrepReckonableAttribute)\b/g,
    plant: "same camelCase wire keys via RtConfig.CamelCaseForProperties",
  },
  /** Internal defect and milestone ids, which resolve nowhere outside this repo. */
  "defect-id": {
    pattern:
      /\b(?:[VATR]-\d+|R7 Fix \d+|F2-fix|P0\.5|M\d(?= concern| milestone))\b/g,
    plant: "restored by V-12 after A-10 dropped it",
  },
  /** Where a fact came from, rather than what the fact is. */
  decompile: {
    pattern: /\bconfirmed via decompile\b/gi,
    plant: "0 means Landed, confirmed via decompile",
  },
};

/**
 * Declarations whose prose still carries maintainer markers, with the count of
 * markers each holds.
 *
 * SHRINK-ONLY. Seeded from the measured state on 2026-09-02 so the convention
 * could land without converting 141 blocks in one commit. A key here may only
 * fall or disappear; a key not here may not appear at all. Adding an entry means
 * writing down that the published surface explains the mod's internals to
 * someone who cannot see them, so do that only with a reason beside it.
 *
 * Tighten with `node scripts/asyncapi-doc.mjs --update-prose-debt` after a
 * conversion, in the same commit. `--reseed-prose-debt` is the only thing that
 * writes a HIGHER number and exists solely for a detector that got sharper: a
 * widened pattern finds offences that were always shipping, and the alternative
 * to recording them is reverting the improvement.
 */
export const PROSE_DEBT = {
  AlternatorEntry: 2,
  ArchiveEntry: 3,
  AstronautComplexInfo: 5,
  BatteryEntry: 2,
  "CareerContracts.completedRecent": 1,
  CareerMode: 7,
  ChannelEmissionReport: 1,
  CommandCentreEntry: 3,
  CommandErrorCode: 1,
  "CommandErrorCode.Timeout": 1,
  "CommandRequest.sentAt": 2,
  "CommandRequest.vantage": 1,
  CommandResult: 1,
  CommandResultOf: 1,
  CrashReport: 4,
  CrewMember: 2,
  CrewRosterEntry: 4,
  DeployedEntry: 2,
  ExperimentBreakdownEntry: 3,
  ExperimentEntry: 6,
  "ExperimentEntry.extensions": 1,
  "FleetSilenceEntry.deadlineBasis": 1,
  FleetVesselSilence: 1,
  "FleetVesselSilence.deadlineBasis": 1,
  "FleetVesselSilence.state": 1,
  FlightCurrent: 1,
  FlightEndReason: 2,
  FuelCellEntry: 2,
  GameDlc: 4,
  GameMode: 1,
  InstrumentEntry: 2,
  LabEntry: 2,
  LaunchSiteEntry: 4,
  "ManeuverNode.id": 1,
  "ManeuverNode.patches": 1,
  "Meta.validAt": 2,
  OrbitPatch: 1,
  PartActions: 1,
  PartsPower: 5,
  PendingUplink: 1,
  "PendingUplink.commandedValue": 1,
  PhysicsMode: 3,
  RecoveryReport: 4,
  "ResourceAmount.active": 2,
  RevertAvailability: 1,
  RoboticsAvailability: 2,
  SasMode: 1,
  SavedShipEntry: 3,
  SensorEntry: 2,
  ServoEntry: 2,
  SetTargetArgs: 2,
  "SetThrottleArgs.value": 1,
  Situation: 2,
  SolarPanelEntry: 2,
  SpaceCenterPartsAvailable: 4,
  SpaceCenterPoiEntry: 4,
  SpaceCenterScene: 3,
  "StageDeltaVEntry.resources": 1,
  StageDeltaVSummary: 2,
  SwitchVesselArgs: 1,
  SystemBodies: 4,
  Vec3: 1,
  VesselAttitude: 2,
  VesselControl: 1,
  "VesselControl.throttle": 1,
  VesselFlight: 2,
  "VesselFlight.latitude": 1,
  VesselIdentity: 1,
  "VesselIdentity.vesselId": 1,
  "VesselOrbit.patches": 1,
  VesselOrbitTruth: 2,
  VesselParts: 5,
  VesselResources: 7,
  VesselStructure: 1,
  VesselSurface: 1,
  VesselTarget: 1,
  "VesselTarget.relativeVelocity": 2,
  WarpMode: 1,
  WarpState: 2,
};

/**
 * Every marker in one description, as `{ family, text }`.
 *
 * Whitespace is COLLAPSED before matching, and that is not cosmetic. `RtDocText`
 * re-wraps every summary at 76 columns, so where a marker phrase falls is a
 * function of how long the preceding sentence happens to be: `never serialized
 * itself` had a line break after `never` and no multi-word pattern saw it. The
 * detector reported one marker on that block and the second was invisible, which
 * is the failure this whole file is built against. Match the prose, not the
 * wrapping.
 *
 * Fenced code and inline code are NOT exempt. A `` `Sitrep.Host.Foo` `` is the
 * commonest form of the producer-type leak in this tree, and exempting code
 * spans would have made the detector blind to two thirds of them.
 */
export function markersIn(description) {
  if (!description) return [];
  const flat = description.replace(/\s+/g, " ");
  const found = [];
  for (const [family, { pattern }] of Object.entries(FAMILIES)) {
    for (const match of flat.matchAll(pattern)) {
      found.push({ family, text: match[0] });
    }
  }
  return found;
}

/**
 * Every documented declaration in the contract, keyed the way the debt list is:
 * `TypeName` for a type's own summary, `TypeName.field` for a member's.
 *
 * Enums and their members are walked the same as interfaces. An enum value's
 * doc comment is often the whole meaning of the value, and three of them name a
 * producer.
 */
export function proseOf(contract) {
  const blocks = [];
  const add = (key, description) => {
    if (description) blocks.push({ key, description });
  };
  for (const [name, declaration] of contract.interfaces) {
    add(name, declaration.description);
    for (const field of declaration.fields)
      add(`${name}.${field.name}`, field.description);
  }
  for (const [name, declaration] of contract.enums) {
    add(name, declaration.description);
    for (const member of declaration.members)
      add(`${name}.${member.name}`, member.description);
  }
  return blocks;
}

/** Current marker counts per declaration, for the gate and for `--update-prose-debt`. */
export function measure(contract) {
  const counts = {};
  const detail = new Map();
  let lines = 0;
  let dirtyLines = 0;
  for (const { key, description } of proseOf(contract)) {
    const blockLines = description.split("\n").length;
    lines += blockLines;
    const markers = markersIn(description);
    if (markers.length === 0) continue;
    counts[key] = markers.length;
    detail.set(key, markers);
    dirtyLines += blockLines;
  }
  return {
    counts,
    detail,
    lines,
    dirtyLines,
    blocks: proseOf(contract).length,
  };
}

/**
 * That every family can still see its own kind of offence.
 *
 * Run before the verdict, never after: a detector reporting a clean tree because
 * its patterns stopped matching is indistinguishable from a clean tree, and the
 * clean-tree reading is the one that lets a build go green.
 */
export function assertDetectorSees() {
  const blind = [];
  for (const [family, { plant }] of Object.entries(FAMILIES)) {
    const seen = markersIn(plant).some((marker) => marker.family === family);
    if (!seen) blind.push(family);
  }
  if (blind.length > 0) {
    throw new Error(
      `asyncapi: the prose detector is BLIND for ${blind.join(", ")}: a planted ` +
        "violation of each was not matched. A pattern that matches nothing reports " +
        "zero markers, and zero reads as a clean contract. Fix the pattern in " +
        "scripts/asyncapi/prose-hygiene.mjs before trusting any verdict from it.",
    );
  }
}

/**
 * The `<internal>` marker surviving into the emitted TypeScript.
 *
 * A separate, absolute check rather than a sixth family. If this fires, the
 * stripper did not run: `contract.ts` is stale against the C#, or the codegen
 * ran a build in which `RtDocText` does not know the element. Every conversion
 * in the tree would be silently inert, which is worse than not having converted
 * them, because the prose reads as deliberately published.
 */
export function assertMarkerWasStripped(contract) {
  const leaked = proseOf(contract).filter(({ description }) =>
    /<\/?internal\b/i.test(description),
  );
  if (leaked.length > 0) {
    throw new Error(
      `asyncapi: ${leaked.length} description(s) still carry a literal <internal> ` +
        `marker: ${leaked
          .map((b) => b.key)
          .slice(0, 8)
          .join(", ")}. RtDocText did ` +
        "not strip it, so contract.ts is stale against the C#. Run `pnpm codegen`.",
    );
  }
}

/**
 * The verdict. Throws on any declaration over its allowance, or on any that has
 * markers and no allowance at all.
 *
 * A count that came in BELOW its allowance only reports. The debt is a CEILING,
 * the same as this repo's other ratchets: a marker count can move for reasons
 * that are not a conversion (a family's pattern widened, a doc comment merged),
 * and failing on a drop teaches people to pad the list.
 */
export function assertProseHygiene(contract, { debt = PROSE_DEBT } = {}) {
  assertDetectorSees();
  assertMarkerWasStripped(contract);

  const { counts, detail, blocks, lines, dirtyLines } = measure(contract);
  const over = [];
  const under = [];
  for (const [key, count] of Object.entries(counts)) {
    const allowed = debt[key] ?? 0;
    if (count > allowed) over.push({ key, count, allowed });
    else if (count < allowed) under.push({ key, count, allowed });
  }
  const fixed = Object.keys(debt).filter((key) => !(key in counts));

  if (over.length > 0) {
    const worst = over
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map(({ key, count, allowed }) => {
        const markers = [
          ...new Set(
            (detail.get(key) ?? []).map((m) => `${m.family}: "${m.text}"`),
          ),
        ];
        return `  ${key} (${count} marker(s), ${allowed} allowed)\n    ${markers.slice(0, 4).join("\n    ")}`;
      })
      .join("\n");
    throw new Error(
      `asyncapi: ${over.length} contract declaration(s) publish maintainer prose ` +
        `beyond their allowance:\n${worst}\n` +
        "Move the WHY into an <internal> block inside the same <summary>, keeping " +
        "the WHAT outside it. Check first for a client-relevant fact buried in the " +
        "implementation sentence (a null rule, a vocabulary, a shape) and REWRITE " +
        "that on the outside rather than dropping it. Then run `pnpm codegen` and " +
        "`node scripts/asyncapi-doc.mjs --update-prose-debt` in the same commit.",
    );
  }

  return {
    blocks,
    lines,
    dirtyLines,
    dirty: Object.keys(counts).length,
    markers: Object.values(counts).reduce((total, count) => total + count, 0),
    slack: under.length + fixed.length,
  };
}
