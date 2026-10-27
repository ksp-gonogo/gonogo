// src/commands.ts
import { registerUplinkCommand } from "@ksp-gonogo/sitrep-sdk";

// src/__generated__/command-map.ts
var GENERATED_COMMAND_RAIL = {
  "kerbalism.file.delete": { replies: true, delayed: true },
  "kerbalism.file.send": { replies: true, delayed: true },
  "kerbalism.repair": { replies: true, delayed: true },
  "kerbalism.sample.analyze": { replies: true, delayed: true },
  "kerbalism.sample.dump": { replies: true, delayed: true },
  "kerbalism.sample.moveToLab": { replies: true, delayed: true }
};
var GENERATED_COMMAND_IDS = [
  "kerbalism.file.delete",
  "kerbalism.file.send",
  "kerbalism.repair",
  "kerbalism.sample.analyze",
  "kerbalism.sample.dump",
  "kerbalism.sample.moveToLab"
];

// src/commands.ts
for (const id of GENERATED_COMMAND_IDS) {
  registerUplinkCommand(id, GENERATED_COMMAND_RAIL[id]);
}

// src/isru.ts
import {
  PROVIDER_EXTENSIONS_FIELD,
  registerProviderExtensionShape
} from "@ksp-gonogo/sitrep-sdk";

// src/topics.ts
import {
  registerUplinkTopic,
  registerCollectionTopic,
  registerEnumMembers,
  registerTopicUnits,
  registerTypeUnits
} from "@ksp-gonogo/sitrep-sdk";

// src/__generated__/topic-map.ts
var GENERATED_COLLECTION_TOPIC_IDS = [
  "kerbalism.crew",
  "kerbalism.reliabilityParts"
];

// src/__generated__/units.ts
var GENERATED_TYPE_UNITS = {
  "KerbalismCrewEntry": {
    deathClockUt: "ut",
    name: "text",
    rulesAsOfKerbalismUt: "ut",
    trait: "text"
  },
  "KerbalismCrewRule": {
    degenPerSec: "units/s",
    fatalThreshold: "units",
    name: "text",
    problem: "units"
  },
  "KerbalismFeatures": {
    automation: "flag",
    comfort: "flag",
    deploy: "flag",
    habitat: "flag",
    livingSpace: "flag",
    poisoning: "flag",
    pressure: "flag",
    radiation: "flag",
    reliability: "flag",
    science: "flag",
    shielding: "flag",
    spaceWeather: "flag",
    supplies: "flag"
  },
  "KerbalismGreenhouseEntry": {
    active: "flag",
    artificial: "W/m\xB2",
    cropResource: "text",
    ecRateMaxPerSec: "units/s",
    foodRatePerSec: "units/s",
    issue: "text",
    lampEcDrawPerSec: "units/s",
    lightToleranceWm2: "W/m\xB2",
    natural: "W/m\xB2",
    pressureTolerance: "ratio",
    radiationToleranceRadPerSec: "rad/s"
  },
  "KerbalismHabitat": {
    comfort: "ratio",
    livingSpace: "ratio",
    poisoning: "ratio",
    pressure: "ratio",
    shielding: "ratio",
    surface: "m\xB2",
    volume: "m\xB3"
  },
  "KerbalismIsruConverterExtension": {
    broken: "flag",
    capacity: "units",
    processToken: "text",
    title: "text",
    valveIndex: "count"
  },
  "KerbalismIsruDrillExtension": {
    ecRate: "units/s",
    harvestType: "text",
    issue: "text",
    sourceMassRemaining: "t",
    sourceMassThreshold: "t"
  },
  "KerbalismLifeSupport": {
    asOfKerbalismUt: "ut",
    rates: "units/s",
    ruleEnvModifiers: "1"
  },
  "KerbalismProcessDef": {
    dumpValves: "text",
    inputs: "units/s",
    modifiers: "text",
    name: "text",
    outputs: "units/s"
  },
  "KerbalismProcessEntry": {
    broken: "flag",
    capacity: "units",
    envModifier: "1",
    flightId: "id",
    resource: "text",
    running: "flag",
    title: "text",
    valveIndex: "count"
  },
  "KerbalismProfile": {
    name: "text"
  },
  "KerbalismReliabilityBudget": {
    consumed: "ratio",
    id: "id",
    kind: "enum",
    label: "text",
    limitSeconds: "s",
    usedSeconds: "s"
  },
  "KerbalismReliabilityPart": {
    condition: "enum",
    conditionDetail: "text",
    mtbfSeconds: "s",
    partId: "id",
    quality: "flag",
    redundancyGroup: "text",
    repairLevel: "count",
    repairTrait: "text",
    title: "text"
  },
  "KerbalismReliabilitySummary": {
    brokenPartCount: "count",
    coverage: "enum",
    criticalChance: "ratio",
    incentiveRedundancy: "flag",
    requireRepairKits: "flag",
    safeModeChance: "ratio",
    serviceDuePartCount: "count",
    worstMtbfSeconds: "s"
  },
  "KerbalismRepairCostItem": {
    name: "id",
    quantity: "count"
  },
  "KerbalismRepairOutcome": {
    kitsFrom: "id",
    kitsUsed: "count",
    repaired: "flag"
  },
  "KerbalismRepairPartArgs": {
    crewName: "text",
    partId: "id"
  },
  "KerbalismResource": {
    amount: "units",
    capacity: "units",
    rate: "units/s"
  },
  "KerbalismResourceDef": {
    density: "kg/m\xB3",
    displayName: "text",
    flowMode: "text",
    flowModeOrdinal: "enum",
    isSupply: "flag",
    lowThreshold: "ratio"
  },
  "KerbalismRuleDef": {
    breakdown: "flag",
    degeneration: "units/s",
    fatalThreshold: "units",
    input: "text",
    interval: "s",
    modifiers: "text",
    name: "text",
    output: "text",
    rate: "units",
    ratePerSecond: "units/s"
  },
  "KerbalismScienceBreakdownExt": {
    percentCollectedTotal: "ratio",
    scienceCollectedInFlight: "science",
    scienceRemainingTotal: "science",
    timesCompleted: "count"
  },
  "KerbalismScienceExperimentExt": {
    analyze: "flag",
    dataSizeMB: "MB",
    kind: "id",
    sampleMass: "t",
    sampleSlotsTotal: "count",
    sampleSlotsUsed: "count",
    sciencePerMB: "science/MB",
    sendFlagged: "flag",
    storageCapacityMB: "MB",
    storageUsedMB: "MB",
    transmitRateMBps: "MB/s",
    transmitting: "flag"
  },
  "KerbalismScienceInstrumentExt": {
    bodyCoveragePercent: "%",
    dataRateMBps: "MB/s",
    ecRate: "units/s",
    expStatus: "id",
    issue: "text",
    kind: "id",
    powerDisabled: "flag",
    prodFactor: "ratio",
    remainingSampleMass: "t",
    runningState: "id",
    scanning: "flag"
  },
  "KerbalismScienceLabExt": {
    analysisRateMBps: "MB/s",
    effectiveRateMBps: "MB/s",
    status: "id"
  },
  "KerbalismSpaceWeather": {
    blackout: "flag",
    habitatRadiationRadPerSecond: "rad/s",
    inSunlight: "flag",
    innerBelt: "flag",
    magnetosphere: "flag",
    outerBelt: "flag",
    radiationRadPerSecond: "rad/s",
    shieldingAmount: "units",
    shieldingCapacity: "units",
    stormEjectionSpeed: "m/s",
    stormInProgress: "flag",
    stormIncoming: "flag"
  },
  "KerbalismStarInfo": {
    "direction.x": "1",
    "direction.y": "1",
    "direction.z": "1",
    distance: "m",
    star: "text"
  },
  "KerbalismStormEntry": {
    dist: "m",
    star: "text",
    stormDuration: "s",
    stormState: "count",
    stormTime: "ut",
    targetKind: "enum",
    targetName: "text"
  },
  "KerbalismSubjectActionArgs": {
    subjectId: "id"
  },
  "KerbalismSubjectFlagArgs": {
    flag: "flag",
    subjectId: "id"
  }
};
var GENERATED_TOPIC_UNITS = {
  "kerbalism.crew": {
    deathClockUt: "ut",
    name: "text",
    rulesAsOfKerbalismUt: "ut",
    trait: "text"
  },
  "kerbalism.features": {
    automation: "flag",
    comfort: "flag",
    deploy: "flag",
    habitat: "flag",
    livingSpace: "flag",
    poisoning: "flag",
    pressure: "flag",
    radiation: "flag",
    reliability: "flag",
    science: "flag",
    shielding: "flag",
    spaceWeather: "flag",
    supplies: "flag"
  },
  "kerbalism.lifesupport": {
    asOfKerbalismUt: "ut",
    rates: "units/s",
    ruleEnvModifiers: "1"
  },
  "kerbalism.profile": {
    name: "text"
  },
  "kerbalism.reliability": {
    brokenPartCount: "count",
    coverage: "enum",
    criticalChance: "ratio",
    incentiveRedundancy: "flag",
    requireRepairKits: "flag",
    safeModeChance: "ratio",
    serviceDuePartCount: "count",
    worstMtbfSeconds: "s"
  },
  "kerbalism.reliabilityParts": {
    condition: "enum",
    conditionDetail: "text",
    mtbfSeconds: "s",
    partId: "id",
    quality: "flag",
    redundancyGroup: "text",
    repairLevel: "count",
    repairTrait: "text",
    title: "text"
  },
  "kerbalism.spaceweather": {
    blackout: "flag",
    habitatRadiationRadPerSecond: "rad/s",
    inSunlight: "flag",
    innerBelt: "flag",
    magnetosphere: "flag",
    outerBelt: "flag",
    radiationRadPerSecond: "rad/s",
    shieldingAmount: "units",
    shieldingCapacity: "units",
    stormEjectionSpeed: "m/s",
    stormInProgress: "flag",
    stormIncoming: "flag"
  }
};
var GENERATED_TYPE_SHAPES = {
  "KerbalismCrewEntry": {
    rules: "KerbalismCrewRule[]"
  },
  "KerbalismLifeSupport": {
    greenhouses: "KerbalismGreenhouseEntry[]",
    habitat: "KerbalismHabitat",
    processes: "KerbalismProcessEntry[]"
  },
  "KerbalismProfile": {
    processes: "KerbalismProcessDef[]",
    resources: "*KerbalismResourceDef",
    rules: "KerbalismRuleDef[]"
  },
  "KerbalismReliabilityPart": {
    budgets: "KerbalismReliabilityBudget[]",
    repairCost: "KerbalismRepairCostItem[]"
  },
  "KerbalismSpaceWeather": {
    stars: "KerbalismStarInfo[]",
    storms: "KerbalismStormEntry[]"
  }
};
var GENERATED_TOPIC_SHAPES = {
  "kerbalism.crew": {
    rules: "KerbalismCrewRule[]"
  },
  "kerbalism.lifesupport": {
    greenhouses: "KerbalismGreenhouseEntry[]",
    habitat: "KerbalismHabitat",
    processes: "KerbalismProcessEntry[]"
  },
  "kerbalism.profile": {
    processes: "KerbalismProcessDef[]",
    resources: "*KerbalismResourceDef",
    rules: "KerbalismRuleDef[]"
  },
  "kerbalism.reliabilityParts": {
    budgets: "KerbalismReliabilityBudget[]",
    repairCost: "KerbalismRepairCostItem[]"
  },
  "kerbalism.spaceweather": {
    stars: "KerbalismStarInfo[]",
    storms: "KerbalismStormEntry[]"
  }
};
var GENERATED_TYPE_ENUMS = {
  "KerbalismReliabilityBudget": {
    kind: null
  },
  "KerbalismReliabilityPart": {
    condition: null
  },
  "KerbalismReliabilitySummary": {
    coverage: null
  },
  "KerbalismResourceDef": {
    flowModeOrdinal: "KspResourceFlowMode"
  },
  "KerbalismStormEntry": {
    targetKind: "KerbalismStormTargetKind"
  }
};
var GENERATED_TOPIC_ENUMS = {
  "kerbalism.reliability": {
    coverage: null
  },
  "kerbalism.reliabilityParts": {
    condition: null
  }
};
var GENERATED_TYPE_STATICS = {};
var GENERATED_TOPIC_STATICS = {};
var GENERATED_ENUM_MEMBERS = {
  "KerbalismStormTargetKind": {
    0: "Body",
    1: "Vessel"
  },
  "KspResourceFlowMode": {
    0: "NO_FLOW",
    1: "ALL_VESSEL",
    2: "STAGE_PRIORITY_FLOW",
    3: "STACK_PRIORITY_SEARCH",
    4: "ALL_VESSEL_BALANCE",
    5: "STAGE_PRIORITY_FLOW_BALANCE",
    6: "STAGE_STACK_FLOW",
    7: "STAGE_STACK_FLOW_BALANCE",
    8: "NULL"
  }
};
var GENERATED_CONTRACT_TAGS = {
  topics: {
    "kerbalism.crew": {
      "*.name": { entryKey: true },
      "*.rules.*.name": { entryKey: true }
    }
  },
  reckonable: [
    { topic: "kerbalism.crew", field: "*.rules.*.problem", basis: "rate-integration", inputs: [{ topic: "", path: "fatalThreshold" }] },
    { topic: "vessel.resources", field: "resources.*.current", basis: "rate-integration", inputs: [{ topic: "kerbalism.lifesupport", path: "rates" }, { topic: "kerbalism.lifesupport", path: "asOfKerbalismUt" }] }
  ]
};

// src/topics.ts
var KERBALISM_AVAILABLE_TOPIC = "kerbalism.available";
var KERBALISM_SPACEWEATHER_TOPIC = "kerbalism.spaceweather";
var KERBALISM_PROFILE_TOPIC = "kerbalism.profile";
var KERBALISM_LIFESUPPORT_TOPIC = "kerbalism.lifesupport";
var KERBALISM_CREW_TOPIC = "kerbalism.crew";
var KERBALISM_FEATURES_TOPIC = "kerbalism.features";
var KERBALISM_RELIABILITY_TOPIC = "kerbalism.reliability";
var KERBALISM_RELIABILITY_PARTS_TOPIC = "kerbalism.reliabilityParts";
registerUplinkTopic(KERBALISM_AVAILABLE_TOPIC);
registerUplinkTopic(KERBALISM_SPACEWEATHER_TOPIC);
registerUplinkTopic(KERBALISM_PROFILE_TOPIC);
registerUplinkTopic(KERBALISM_LIFESUPPORT_TOPIC);
registerUplinkTopic(KERBALISM_CREW_TOPIC);
registerUplinkTopic(KERBALISM_FEATURES_TOPIC);
registerUplinkTopic(KERBALISM_RELIABILITY_TOPIC);
registerUplinkTopic(KERBALISM_RELIABILITY_PARTS_TOPIC);
for (const topic of GENERATED_COLLECTION_TOPIC_IDS) {
  registerCollectionTopic(topic);
}
for (const topic of /* @__PURE__ */ new Set([
  ...Object.keys(GENERATED_TOPIC_UNITS),
  ...Object.keys(GENERATED_TOPIC_SHAPES)
])) {
  registerTopicUnits(
    topic,
    GENERATED_TOPIC_UNITS[topic] ?? {},
    GENERATED_TOPIC_SHAPES[topic] ?? {},
    GENERATED_TOPIC_STATICS[topic] ?? [],
    GENERATED_TOPIC_ENUMS[topic] ?? {}
  );
}
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(
    typeName,
    units,
    GENERATED_TYPE_SHAPES[typeName] ?? {},
    GENERATED_TYPE_STATICS[typeName] ?? [],
    GENERATED_TYPE_ENUMS[typeName] ?? {}
  );
}
for (const [enumName, members] of Object.entries(GENERATED_ENUM_MEMBERS)) {
  registerEnumMembers(enumName, members);
}

// src/isru.ts
var KERBALISM_ISRU_PROVIDER_ID = "kerbalism";
var ISRU_DRILLS_TOPIC = "isru.drills";
var ISRU_CONVERTERS_TOPIC = "isru.converters";
registerProviderExtensionShape(
  ISRU_DRILLS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  "KerbalismIsruDrillExtension"
);
registerProviderExtensionShape(
  ISRU_CONVERTERS_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  "KerbalismIsruConverterExtension"
);
function read(payload) {
  const bag = payload?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === void 0 || bag === null || typeof bag !== "object") {
    return void 0;
  }
  const namespaced = bag[KERBALISM_ISRU_PROVIDER_ID];
  if (namespaced === null || typeof namespaced !== "object") return void 0;
  return namespaced;
}
function readKerbalismIsruDrillExt(entry) {
  return read(entry);
}
function readKerbalismIsruConverterExt(entry) {
  return read(entry);
}

// src/science.ts
import {
  PROVIDER_EXTENSIONS_FIELD as PROVIDER_EXTENSIONS_FIELD2,
  registerProviderExtensionShape as registerProviderExtensionShape2
} from "@ksp-gonogo/sitrep-sdk";

// src/units.ts
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";
var KERBALISM_UNIT_SYMBOLS = ["MB", "MB/s", "science/MB"];
var BYTE_RUNGS = [
  { from: 8, symbol: "B", per: 8 },
  { from: 8e3, symbol: "kB", per: 8e3 },
  { from: 8e6, symbol: "MB", per: 8e6 },
  { from: 8e9, symbol: "GB", per: 8e9 }
];
var BYTE_RATE_RUNGS = [
  { from: 8, symbol: "B/s", per: 8 },
  { from: 8e3, symbol: "kB/s", per: 8e3 },
  { from: 8e6, symbol: "MB/s", per: 8e6 },
  { from: 8e9, symbol: "GB/s", per: 8e9 }
];
registerUnit({
  symbol: "MB",
  kind: "data",
  dimension: { bit: 1 },
  ratio: 8e6,
  ladder: "bytes",
  rungs: BYTE_RUNGS
});
registerUnit({
  symbol: "MB/s",
  kind: "dataRate",
  dimension: { bit: 1, s: -1 },
  ratio: 8e6,
  ladder: "byteRate",
  rungs: BYTE_RATE_RUNGS
});
registerUnit({
  symbol: "science/MB",
  kind: "scienceDensity",
  dimension: { science: 1, bit: -1 },
  ratio: 1 / 8e6
});

// src/science.ts
var KERBALISM_SCIENCE_PROVIDER_ID = "kerbalism";
var KERBALISM_SCIENCE_VALUE_MODEL = "kerbalism-linear";
var SCIENCE_EXPERIMENTS_TOPIC = "science.experiments";
var SCIENCE_INSTRUMENTS_TOPIC = "science.instruments";
var SCIENCE_LAB_TOPIC = "science.lab";
var SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC = "science.experimentBreakdown";
registerProviderExtensionShape2(
  SCIENCE_EXPERIMENTS_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceExperimentExt"
);
registerProviderExtensionShape2(
  SCIENCE_INSTRUMENTS_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceInstrumentExt"
);
registerProviderExtensionShape2(
  SCIENCE_LAB_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceLabExt"
);
registerProviderExtensionShape2(
  SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  "KerbalismScienceBreakdownExt"
);
function read2(payload) {
  const bag = payload?.[PROVIDER_EXTENSIONS_FIELD2];
  if (bag === void 0 || bag === null || typeof bag !== "object") {
    return void 0;
  }
  const namespaced = bag[KERBALISM_SCIENCE_PROVIDER_ID];
  if (namespaced === null || typeof namespaced !== "object") return void 0;
  return namespaced;
}
function readKerbalismScienceExperimentExt(entry) {
  return read2(entry);
}
function readKerbalismScienceInstrumentExt(entry) {
  return read2(entry);
}
function readKerbalismScienceLabExt(entry) {
  return read2(entry);
}
function readKerbalismScienceBreakdownExt(entry) {
  return read2(entry);
}

// src/uplink.ts
import { defineUplinkClient, registerErrorCodes } from "@ksp-gonogo/sitrep-sdk";

// src/__generated__/error-codes.ts
var KERBALISM_ERROR_CODES = [
  {
    id: "kerbalism.continuousScience",
    kind: "refusal",
    refines: "modeUnavailable",
    origin: null,
    sentence: "Kerbalism runs and transmits experiments on its own",
    meaning: "Kerbalism runs and transmits experiments continuously on its own, so a one-shot deploy or transmit has nothing to act on."
  },
  {
    id: "kerbalism.experimentNotSwitched",
    kind: "refusal",
    refines: "modeUnavailable",
    origin: null,
    sentence: "Kerbalism would not switch the experiment just now",
    meaning: "Kerbalism left the experiment as it was: it is broken, its animation is still moving, the same experiment is running elsewhere on the craft, or its fairing is still on."
  },
  {
    id: "kerbalism.scienceNotModelled",
    kind: "refusal",
    refines: "modeUnavailable",
    origin: null,
    sentence: "Kerbalism is not modelling science here",
    meaning: "Kerbalism is not modelling science on this vessel, so there is no file or sample to act on."
  },
  {
    id: "kerbalism.noDriveSpace",
    kind: "refusal",
    refines: "limitReached",
    origin: null,
    sentence: "no drive beside a lab has room for the whole sample",
    meaning: "No drive beside a lab, other than the one holding it, has room for the whole sample."
  },
  {
    id: "kerbalism.driveRefused",
    kind: "refusal",
    refines: "modeUnavailable",
    origin: null,
    sentence: "the Kerbalism drive did not make the change",
    meaning: "A Kerbalism drive was asked to change a file or sample and reported that it had not."
  },
  {
    id: "kerbalism.noSuchCrew",
    kind: "refusal",
    refines: "notFound",
    origin: null,
    sentence: "no crew member aboard has that name",
    meaning: "Nobody aboard the craft answers to the name the repair was given."
  },
  {
    id: "kerbalism.crewNotQualified",
    kind: "refusal",
    refines: "capabilityMismatch",
    origin: null,
    sentence: "that kerbal does not meet Kerbalism's repair specs",
    meaning: "The kerbal lacks the trait or experience level Kerbalism's repair specs ask for, which it raises by one level for a critical failure."
  },
  {
    id: "kerbalism.evaImpossible",
    kind: "refusal",
    refines: "notClearToProceed",
    origin: null,
    sentence: "the crew cannot get out to it yet",
    meaning: "The kerbal cannot get out to the part: the hatch is inside a fairing, which clears once it is jettisoned."
  },
  {
    id: "kerbalism.noKits",
    kind: "refusal",
    refines: "insufficientResource",
    origin: null,
    sentence: "there are not enough repair kits aboard",
    meaning: "The save requires repair kits and the kerbal and the craft's stores hold fewer than the repair takes."
  },
  {
    id: "kerbalism.reliabilityNotModelled",
    kind: "refusal",
    refines: "modeUnavailable",
    origin: null,
    sentence: "Kerbalism is not modelling part failures in this save",
    meaning: "Kerbalism's reliability feature or its MTBF failures are switched off in this save, so no part is breaking."
  },
  {
    id: "kerbalism.nothingToRepair",
    kind: "refusal",
    refines: "notFound",
    origin: null,
    sentence: "no part aboard with that id is broken or due a service",
    meaning: "No reliability module aboard has that id and is broken or due a service."
  }
];

// src/uplink.ts
var UPLINK_VERSION = "1.0.0-rc.4";
var KERBALISM = defineUplinkClient({
  id: "kerbalism",
  version: UPLINK_VERSION,
  name: "Kerbalism",
  description: "Kerbalism life support as one ledger: every profile resource as a meter with the per-source rates that move it, plus wear, habitat, processes and power.",
  tags: GENERATED_CONTRACT_TAGS
});
registerErrorCodes(KERBALISM_ERROR_CODES);

// src/processor.ts
import { deriveReading, observedAt } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOr as magnitudeOr2 } from "@ksp-gonogo/ui-kit";

// src/ecosystem.ts
import {
  KSP_RESOURCE_FLOW_MODE_NAMES,
  KspResourceFlowMode
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, magnitudeOr } from "@ksp-gonogo/ui-kit";
var POOLED_MODES = /* @__PURE__ */ new Set([
  KspResourceFlowMode.ALL_VESSEL,
  KspResourceFlowMode.ALL_VESSEL_BALANCE
]);
function pooledFrom(ordinal) {
  if (ordinal == null) return void 0;
  if (POOLED_MODES.has(ordinal)) return true;
  return KSP_RESOURCE_FLOW_MODE_NAMES.has(ordinal) ? false : void 0;
}
function resourceFacts(profile) {
  const out = /* @__PURE__ */ new Map();
  for (const [name, def] of Object.entries(profile?.resources ?? {})) {
    out.set(name, {
      name,
      displayName: def.displayName || name,
      flowMode: def.flowMode ?? "",
      isSupply: def.isSupply === true,
      pooled: pooledFrom(def.flowModeOrdinal)
    });
  }
  return out;
}
function processesByModifier(profile) {
  const out = /* @__PURE__ */ new Map();
  for (const proc of profile?.processes ?? []) {
    for (const token of proc.modifiers ?? []) out.set(token, proc);
  }
  return out;
}
function buildLedger({
  resource,
  profile,
  lifeSupport,
  crew
}) {
  const byModifier = processesByModifier(profile);
  const terms = [];
  for (const entry of lifeSupport?.processes ?? []) {
    if (entry.broken === true || entry.running !== true) continue;
    const def = entry.resource ? byModifier.get(entry.resource) : void 0;
    if (!def) continue;
    const capacity = magnitudeOr(entry.capacity, 0);
    const perCapacityIn = magnitudeOr(def.inputs?.[resource], Number.NaN);
    const perCapacityOut = magnitudeOr(def.outputs?.[resource], Number.NaN);
    const signed = (Number.isNaN(perCapacityOut) ? 0 : perCapacityOut) - (Number.isNaN(perCapacityIn) ? 0 : perCapacityIn);
    if (signed === 0) continue;
    const envModifier = magnitudeOr(entry.envModifier, 1);
    terms.push({
      name: def.name || entry.title || entry.resource || "process",
      kind: "process",
      flightId: magnitudeOf(entry.flightId) ?? void 0,
      ratePerSecond: signed * capacity * envModifier,
      scale: capacity
    });
  }
  for (const rule of profile?.rules ?? []) {
    const perSecond = magnitudeOr(rule.ratePerSecond, 0);
    if (perSecond === 0) continue;
    const signed = rule.input === resource ? -perSecond : rule.output === resource ? perSecond : 0;
    if (signed === 0) continue;
    const ruleEnvModifier = magnitudeOr(
      rule.name ? lifeSupport?.ruleEnvModifiers?.[rule.name] : void 0,
      1
    );
    terms.push({
      name: rule.name || "rule",
      kind: "rule",
      ratePerSecond: signed * crew * ruleEnvModifier,
      scale: crew
    });
  }
  terms.sort((a, b) => Math.abs(b.ratePerSecond) - Math.abs(a.ratePerSecond));
  const derivedNet = terms.reduce((sum, t) => sum + t.ratePerSecond, 0);
  const reported = lifeSupport?.rates?.[resource];
  const reportedNet = magnitudeOf(reported) ?? void 0;
  return {
    resource,
    terms,
    derivedNet,
    reportedNet,
    residual: reportedNet === void 0 ? void 0 : reportedNet - derivedNet
  };
}
function buildGraph(profile) {
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const node = (id, label, kind) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind });
    if (!edges.has(id)) edges.set(id, /* @__PURE__ */ new Set());
    return id;
  };
  const link = (from, to) => {
    edges.get(from)?.add(to);
  };
  const res = (name) => node(`r:${name}`, name, "resource");
  for (const proc of profile?.processes ?? []) {
    const id = node(`p:${proc.name}`, proc.name || "process", "process");
    for (const name of Object.keys(proc.inputs ?? {})) link(res(name), id);
    for (const name of Object.keys(proc.outputs ?? {})) link(id, res(name));
  }
  for (const rule of profile?.rules ?? []) {
    if (!rule.input && !rule.output) continue;
    const id = node(`u:${rule.name}`, rule.name || "rule", "rule");
    if (rule.input) link(res(rule.input), id);
    if (rule.output) link(id, res(rule.output));
  }
  return { nodes, edges };
}
function stronglyConnected(graph) {
  const index = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const onStack = /* @__PURE__ */ new Set();
  const stack = [];
  const out = [];
  let counter = 0;
  for (const root of graph.nodes.keys()) {
    if (index.has(root)) continue;
    const work = [
      { node: root, next: 0, succ: [...graph.edges.get(root) ?? []] }
    ];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next < frame.succ.length) {
        const child = frame.succ[frame.next++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          work.push({
            node: child,
            next: 0,
            succ: [...graph.edges.get(child) ?? []]
          });
        } else if (onStack.has(child)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) ?? 0, index.get(child) ?? 0)
          );
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0)
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        for (; ; ) {
          const popped = stack.pop();
          if (popped === void 0) break;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        out.push(component);
      }
    }
  }
  return out;
}
function closedLoops(profile) {
  const graph = buildGraph(profile);
  return stronglyConnected(graph).filter((c) => c.length > 1).map(
    (c) => c.filter((id) => id.startsWith("r:")).map((id) => id.slice(2)).sort()
  ).filter((c) => c.length > 0).sort((a, b) => b.length - a.length);
}
var DEFAULT_MATERIALITY = 0.05;
function diagnose({
  profile,
  lifeSupport,
  stored,
  materiality = DEFAULT_MATERIALITY
}) {
  const net = {};
  for (const [name, rate] of Object.entries(lifeSupport?.rates ?? {})) {
    const perSecond = magnitudeOf(rate);
    if (perSecond !== null) net[name] = perSecond;
  }
  const short = new Set(Object.keys(net).filter((r) => net[r] < 0));
  const byModifier = processesByModifier(profile);
  const blames = /* @__PURE__ */ new Map();
  for (const resource of short) {
    const gap = Math.abs(net[resource]);
    const set = /* @__PURE__ */ new Set();
    for (const entry of lifeSupport?.processes ?? []) {
      if (entry.broken === true || entry.running !== true) continue;
      const def = entry.resource ? byModifier.get(entry.resource) : void 0;
      const produced = def?.outputs?.[resource];
      if (!def || produced === void 0) continue;
      if (magnitudeOr(produced, 0) * magnitudeOr(entry.capacity, 0) < gap * materiality)
        continue;
      for (const input of Object.keys(def.inputs ?? {})) {
        if (input === resource) continue;
        if (short.has(input) || (stored[input] ?? 0) <= 0) set.add(input);
      }
    }
    blames.set(resource, set);
  }
  const names = [
    .../* @__PURE__ */ new Set([...short, ...[...blames.values()].flatMap((s) => [...s])])
  ];
  const graph = {
    nodes: new Map(
      names.map((n) => [n, { id: n, label: n, kind: "resource" }])
    ),
    edges: new Map(names.map((n) => [n, /* @__PURE__ */ new Set([...blames.get(n) ?? []])]))
  };
  const components = stronglyConnected(graph).map((c) => c.sort());
  const owner = /* @__PURE__ */ new Map();
  components.forEach((c, i) => {
    for (const n of c) owner.set(n, i);
  });
  const out = /* @__PURE__ */ new Map();
  for (const n of names) {
    for (const m of blames.get(n) ?? []) {
      const a = owner.get(n);
      const b = owner.get(m);
      if (a !== void 0 && b !== void 0 && a !== b) {
        if (!out.has(a)) out.set(a, /* @__PURE__ */ new Set());
        out.get(a)?.add(b);
      }
    }
  }
  const reachesMe = /* @__PURE__ */ new Map();
  for (const [a, bs] of out) {
    for (const b of bs) {
      if (!reachesMe.has(b)) reachesMe.set(b, /* @__PURE__ */ new Set());
      reachesMe.get(b)?.add(a);
    }
  }
  const downstreamOf = (i) => {
    const seen = /* @__PURE__ */ new Set();
    const queue = [...reachesMe.get(i) ?? []];
    while (queue.length > 0) {
      const next = queue.pop();
      if (next === void 0 || seen.has(next)) continue;
      seen.add(next);
      queue.push(...reachesMe.get(next) ?? []);
    }
    return seen;
  };
  return components.map((resources, i) => ({
    resources,
    cycle: resources.length > 1,
    role: out.get(i)?.size ? "downstream" : "root",
    net: Object.fromEntries(resources.map((r) => [r, net[r] ?? 0])),
    blockedBy: [
      ...new Set(
        resources.flatMap(
          (r) => [...blames.get(r) ?? []].filter((m) => owner.get(m) !== i)
        )
      )
    ].sort(),
    explains: [...downstreamOf(i)].flatMap((j) => components[j]).sort()
  })).sort((a, b) => {
    if (a.role !== b.role) return a.role === "root" ? -1 : 1;
    return b.explains.length - a.explains.length;
  });
}
function summarise({
  profile,
  lifeSupport,
  stored,
  capacity,
  crew,
  crossings
}) {
  const facts = resourceFacts(profile);
  const groups = diagnose({ profile, lifeSupport, stored });
  const loops = closedLoops(profile);
  const roleOf = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const name of group.resources) roleOf.set(name, group);
  }
  const loopOf = /* @__PURE__ */ new Map();
  for (const loop of loops) {
    for (const name of loop) if (!loopOf.has(name)) loopOf.set(name, loop);
  }
  const displayNameOf = (name) => facts.get(name)?.displayName ?? name;
  const row = (f) => {
    const amount = stored[f.name] ?? 0;
    const cap = capacity[f.name] ?? 0;
    const reported = lifeSupport?.rates?.[f.name];
    const group = roleOf.get(f.name);
    const low = profile?.resources?.[f.name]?.lowThreshold;
    const lowMagnitude = low === void 0 ? void 0 : magnitudeOr(low, Number.NaN);
    return {
      name: f.name,
      displayName: f.displayName,
      amount,
      capacity: cap,
      fraction: cap > 0 ? amount / cap : null,
      ratePerSecond: magnitudeOf(reported),
      crossing: crossings?.[f.name] ?? null,
      isSupply: f.isSupply,
      pooled: f.pooled,
      closed: loopOf.has(f.name),
      loop: loopOf.get(f.name) ?? null,
      role: group?.role ?? null,
      blockedBy: group?.role === "downstream" ? group.blockedBy.map(displayNameOf) : [],
      explains: group?.role === "root" ? group.explains.map(displayNameOf) : [],
      belowLowThreshold: lowMagnitude === void 0 || Number.isNaN(lowMagnitude) || cap <= 0 ? void 0 : amount / cap < lowMagnitude
    };
  };
  const floorUt = (r) => r.crossing?.boundary === "floor" ? r.crossing.atUt : Number.POSITIVE_INFINITY;
  const ROLE_ORDER = { root: 0, downstream: 1 };
  const order = (a, b) => {
    const ra = a.role ? ROLE_ORDER[a.role] : 2;
    const rb = b.role ? ROLE_ORDER[b.role] : 2;
    if (ra !== rb) return ra - rb;
    const ta = floorUt(a);
    const tb = floorUt(b);
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  };
  const rows = [...facts.values()].map(row);
  return {
    causes: rows.filter((r) => r.role === "root").sort(order),
    supplies: rows.filter((r) => r.isSupply).sort(order),
    other: rows.filter((r) => !r.isSupply).sort(order),
    wear: wearRows({ profile, lifeSupport, stored, capacity, crew, crossings })
  };
}
function wearDrains({
  profile,
  lifeSupport
}) {
  const byModifier = processesByModifier(profile);
  const out = [];
  for (const entry of lifeSupport?.processes ?? []) {
    if (entry.broken === true || entry.running !== true) continue;
    const def = entry.resource ? byModifier.get(entry.resource) : void 0;
    if (!def) continue;
    for (const [name, perCapacity] of Object.entries(def.inputs ?? {})) {
      if (!name.startsWith("_") || name === entry.resource) continue;
      const perCapacityIn = magnitudeOf(perCapacity);
      const processCapacity = magnitudeOf(entry.capacity);
      const drain = perCapacityIn === null || processCapacity === null ? null : perCapacityIn * processCapacity;
      out.push({
        name,
        process: def.name || entry.title || name,
        drainPerSecond: drain !== null && Number.isFinite(drain) ? drain : null
      });
    }
  }
  return out;
}
function wearRates({
  profile,
  lifeSupport
}) {
  const rates = {};
  for (const { name, drainPerSecond } of wearDrains({ profile, lifeSupport })) {
    if (drainPerSecond === null || !(drainPerSecond > 0)) continue;
    rates[name] = (rates[name] ?? 0) - drainPerSecond;
  }
  return rates;
}
function wearRows({
  profile,
  lifeSupport,
  stored,
  capacity,
  crossings
}) {
  const out = wearDrains({ profile, lifeSupport }).map(
    ({ name, process, drainPerSecond }) => {
      const amount = stored[name] ?? 0;
      const cap = capacity[name] ?? 0;
      return {
        name,
        process,
        amount,
        capacity: cap,
        fraction: cap > 0 ? amount / cap : null,
        drainPerSecond,
        crossing: crossings?.[name] ?? null
      };
    }
  );
  const floorUt = (w) => w.crossing?.boundary === "floor" ? w.crossing.atUt : Number.POSITIVE_INFINITY;
  return out.sort((a, b) => floorUt(a) - floorUt(b));
}

// src/levelTrend.ts
var TREND_WINDOW_SECONDS = 120;
var TREND_MIN_SAMPLES = 4;
var TREND_MIN_SPAN_SECONDS = 30;
var MIN_CHANGE_OF_CAPACITY = 1e-3;
var NOISE_SIGMAS = 3;
function significant(change, capacity, sigma) {
  return Math.abs(change) > NOISE_SIGMAS * sigma && Math.abs(change) > MIN_CHANGE_OF_CAPACITY * capacity;
}
var LevelHistory = class {
  byName = /* @__PURE__ */ new Map();
  newestUt = Number.NEGATIVE_INFINITY;
  /**
   * Adds the levels observed at `ut`. Seeing the same observation again adds
   * nothing, and one from earlier than the newest (a recording scrubbed
   * backwards) starts the history over.
   */
  record(ut, amounts) {
    if (!Number.isFinite(ut)) return;
    if (ut === this.newestUt) return;
    if (ut < this.newestUt) this.byName.clear();
    this.newestUt = ut;
    for (const [name, amount] of Object.entries(amounts)) {
      if (!Number.isFinite(amount)) continue;
      const samples = this.byName.get(name) ?? [];
      samples.push({ ut, amount });
      while (samples.length > 0 && samples[0].ut < ut - TREND_WINDOW_SECONDS) {
        samples.shift();
      }
      this.byName.set(name, samples);
    }
  }
  reset() {
    this.byName.clear();
    this.newestUt = Number.NEGATIVE_INFINITY;
  }
  trend(name, capacity) {
    const samples = this.byName.get(name) ?? [];
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (samples.length < TREND_MIN_SAMPLES || last.ut - first.ut < TREND_MIN_SPAN_SECONDS) {
      return { kind: "unknown" };
    }
    const n = samples.length;
    const meanUt = samples.reduce((sum, s) => sum + s.ut, 0) / n;
    const meanAmount = samples.reduce((sum, s) => sum + s.amount, 0) / n;
    let covariance = 0;
    let variance = 0;
    for (const s of samples) {
      covariance += (s.ut - meanUt) * (s.amount - meanAmount);
      variance += (s.ut - meanUt) ** 2;
    }
    const perSecond = covariance / variance;
    const intercept = meanAmount - perSecond * meanUt;
    const residual = samples.reduce(
      (sum, s) => sum + (s.amount - (intercept + perSecond * s.ut)) ** 2,
      0
    );
    const sigma = Math.sqrt(residual / Math.max(1, n - 2));
    const spanSeconds = last.ut - first.ut;
    if (!significant(perSecond * spanSeconds, capacity, sigma)) {
      return { kind: "steady", spanSeconds };
    }
    return {
      kind: perSecond < 0 ? "falling" : "rising",
      perSecond,
      spanSeconds
    };
  }
};
function reconcileCrossing(crossing, trend, level) {
  if (trend.kind === "unknown") return crossing;
  if (trend.kind === "steady") {
    if (crossing === null) return null;
    const distance2 = crossing.boundary === "floor" ? level.current : level.capacity - level.current;
    const seconds2 = crossing.atUt - level.ut;
    if (seconds2 <= 0) return null;
    const expected = distance2 / seconds2 * trend.spanSeconds;
    return expected > MIN_CHANGE_OF_CAPACITY * level.capacity ? null : crossing;
  }
  const boundary = trend.kind === "falling" ? "floor" : "ceiling";
  if (crossing?.boundary === boundary) return crossing;
  const distance = boundary === "floor" ? level.current : level.capacity - level.current;
  return {
    boundary,
    atUt: level.ut + distance / Math.abs(trend.perSecond)
  };
}

// src/resourceReckoning.ts
import { value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf2 } from "@ksp-gonogo/ui-kit";

// src/shadowHorizon.ts
import {
  bodyAtIndex,
  buildElements,
  deriveCelestialFacts,
  poseAtIndex,
  propagateVesselOrbit,
  systemPosesAt
} from "@ksp-gonogo/sitrep-sdk";
var SAMPLES_PER_REVOLUTION = 720;
var BISECTION_STEPS = 40;
function inShadow(position, sunward, radius) {
  const along = position[0] * sunward[0] + position[1] * sunward[1] + position[2] * sunward[2];
  if (along >= 0) return false;
  const px = position[0] - along * sunward[0];
  const py = position[1] - along * sunward[1];
  const pz = position[2] - along * sunward[2];
  return Math.hypot(px, py, pz) < radius;
}
function nextLightChange(orbit, bodies, anchorUt) {
  if (orbit == null || bodies?.bodies == null) return null;
  const facts = deriveCelestialFacts(bodies.bodies);
  const body = bodyAtIndex(facts, orbit.referenceBodyIndex);
  const radius = body?.radius;
  if (body == null || radius == null || !(radius > 0)) return null;
  const pose = poseAtIndex(
    systemPosesAt(facts, anchorUt, null),
    orbit.referenceBodyIndex
  );
  if (pose?.position == null || pose.currency === "withdrawn") return null;
  const [bx, by, bz] = pose.position;
  const distance = Math.hypot(bx, by, bz);
  if (!(distance > 0)) return null;
  const sunward = [-bx / distance, -by / distance, -bz / distance];
  const elements = buildElements(orbit);
  const { sma, ecc, mu } = elements;
  if (![sma, ecc, mu].every(Number.isFinite) || ecc >= 1 || sma <= 0) {
    return null;
  }
  if (sma * (1 - ecc) <= radius) return null;
  const period = 2 * Math.PI * Math.sqrt(sma * sma * sma / mu);
  if (!(period > 0)) return null;
  const shadowedAt = (ut) => {
    const state = propagateVesselOrbit(orbit, ut);
    return state === null ? null : inShadow(state.position, sunward, radius);
  };
  const start = shadowedAt(anchorUt);
  if (start === null) return null;
  const step = period / SAMPLES_PER_REVOLUTION;
  for (let i = 1; i <= SAMPLES_PER_REVOLUTION; i++) {
    const ut = anchorUt + i * step;
    const here = shadowedAt(ut);
    if (here === null) return null;
    if (here === start) continue;
    let lo = ut - step;
    let hi = ut;
    for (let n = 0; n < BISECTION_STEPS; n++) {
      const mid = (lo + hi) / 2;
      if (shadowedAt(mid) === start) lo = mid;
      else hi = mid;
    }
    return { seconds: hi - anchorUt, enters: start ? "sunlight" : "shadow" };
  }
  return null;
}

// src/resourceReckoning.ts
var RESOURCE_RATE_HORIZON_SECONDS = 1200;
function runningProcesses(lifeSupport, profile) {
  const byModifier = processesByModifier(profile);
  const out = [];
  for (const entry of lifeSupport.processes ?? []) {
    if (entry.broken === true || entry.running !== true) continue;
    const def = entry.resource ? byModifier.get(entry.resource) : void 0;
    const capacity = magnitudeOf2(entry.capacity);
    if (!def || capacity === null || capacity <= 0) continue;
    const scale = capacity * (magnitudeOf2(entry.envModifier) ?? 1);
    const contribution = /* @__PURE__ */ new Map();
    for (const [name, rate] of Object.entries(def.outputs ?? {})) {
      contribution.set(name, (magnitudeOf2(rate) ?? 0) * scale);
    }
    for (const [name, rate] of Object.entries(def.inputs ?? {})) {
      contribution.set(
        name,
        (contribution.get(name) ?? 0) - (magnitudeOf2(rate) ?? 0) * scale
      );
    }
    out.push({ inputs: new Set(Object.keys(def.inputs ?? {})), contribution });
  }
  return out;
}
function levelAt(current, segments, ut) {
  let level = current;
  segments.forEach((segment, i) => {
    const end = Math.min(ut, segments[i + 1]?.fromUt ?? ut);
    if (end > segment.fromUt)
      level += segment.perSecond * (end - segment.fromUt);
  });
  return level;
}
function firstCrossing(current, capacity, segments) {
  let level = current;
  for (let i = 0; i < segments.length; i++) {
    const { fromUt, perSecond } = segments[i];
    const duration = (segments[i + 1]?.fromUt ?? Number.POSITIVE_INFINITY) - fromUt;
    if (perSecond < 0 && level + perSecond * duration <= 0) {
      return { atUt: fromUt + level / -perSecond, boundary: "floor" };
    }
    if (perSecond > 0 && level + perSecond * duration >= capacity) {
      return {
        atUt: fromUt + (capacity - level) / perSecond,
        boundary: "ceiling"
      };
    }
    level += perSecond * duration;
  }
  return null;
}
function movingLevels(observed, lifeSupport, rates, profile, asOfUt) {
  const tracked = /* @__PURE__ */ new Map();
  const measured = /* @__PURE__ */ new Map();
  for (const name of Object.keys(rates).sort()) {
    const amount = observed.resources[name];
    const perSecond = magnitudeOf2(rates[name]);
    if (!amount || perSecond === null) continue;
    const current = magnitudeOf2(amount.current);
    const capacity = magnitudeOf2(amount.max);
    if (current === null || capacity === null) continue;
    measured.set(name, perSecond);
    tracked.set(name, {
      current,
      capacity,
      segments: [{ fromUt: asOfUt, perSecond }]
    });
  }
  const running = runningProcesses(lifeSupport, profile);
  const alive = new Set(running);
  const rate = new Map(measured);
  while (alive.size > 0) {
    let stopsAt = Number.POSITIVE_INFINITY;
    let emptied = null;
    for (const [name, level] of tracked) {
      if (level.current <= 0 || !running.some((p) => alive.has(p) && p.inputs.has(name))) {
        continue;
      }
      const crossing = firstCrossing(
        level.current,
        level.capacity,
        level.segments
      );
      if (crossing?.boundary === "floor" && crossing.atUt < stopsAt) {
        stopsAt = crossing.atUt;
        emptied = name;
      }
    }
    if (emptied === null) break;
    for (const process of running) {
      if (!alive.has(process) || !process.inputs.has(emptied)) continue;
      alive.delete(process);
      for (const [name, contributed] of process.contribution) {
        const level = tracked.get(name);
        if (!level) continue;
        const next = (rate.get(name) ?? 0) - contributed;
        rate.set(name, next);
        const last = level.segments[level.segments.length - 1];
        if (last.fromUt === stopsAt) {
          level.segments[level.segments.length - 1] = {
            fromUt: stopsAt,
            perSecond: next
          };
        } else {
          level.segments.push({ fromUt: stopsAt, perSecond: next });
        }
      }
    }
  }
  const moving = [];
  for (const [name, level] of tracked) {
    if (level.segments.every((segment) => segment.perSecond === 0)) continue;
    const crossing = firstCrossing(
      level.current,
      level.capacity,
      level.segments
    );
    const lastRate = level.segments[level.segments.length - 1].perSecond;
    moving.push({
      name,
      current: level.current,
      capacity: level.capacity,
      segments: level.segments,
      boundary: crossing?.boundary ?? (lastRate < 0 ? "floor" : "ceiling"),
      crossesAtUt: crossing?.atUt ?? Number.POSITIVE_INFINITY
    });
  }
  return moving;
}
function ratesWithWear(lifeSupport, profile) {
  const wear = wearRates({ profile, lifeSupport });
  const names = Object.keys(wear);
  if (lifeSupport.rates == null && names.length === 0) return null;
  const merged = {};
  for (const name of names) merged[name] = value("units/s", wear[name]);
  return { ...merged, ...lifeSupport.rates };
}
function resourceBoundaryCrossings(observed, lifeSupport, profile) {
  if (observed == null || lifeSupport == null) return [];
  const rates = ratesWithWear(lifeSupport, profile);
  if (rates === null) return [];
  const asOfUt = magnitudeOf2(lifeSupport.asOfKerbalismUt);
  if (asOfUt === null) return [];
  return movingLevels(observed, lifeSupport, rates, profile, asOfUt).filter(({ crossesAtUt }) => Number.isFinite(crossesAtUt)).map(({ name, boundary, crossesAtUt }) => ({
    resource: name,
    boundary,
    atUt: value("ut", crossesAtUt)
  }));
}
var FLAT_HORIZON = { seconds: RESOURCE_RATE_HORIZON_SECONDS };
function rateHorizon(orbit, bodies, asOfUt) {
  const change = nextLightChange(orbit, bodies, asOfUt);
  return change === null ? FLAT_HORIZON : { seconds: change.seconds, enters: change.enters };
}
function intervalOrDecline(asOfUt, reckonUt, horizon) {
  const elapsed = reckonUt - asOfUt;
  if (!Number.isFinite(elapsed)) {
    return {
      reason: "model-inapplicable",
      note: "reckon time is not a number"
    };
  }
  if (elapsed <= 0) {
    return {
      reason: "model-inapplicable",
      note: "no interval since Kerbalism last evaluated"
    };
  }
  if (elapsed > horizon.seconds) {
    return {
      reason: "beyond-horizon",
      input: "@kerbalism.lifesupport#rates",
      note: horizon.enters === void 0 ? `rates measured ${Math.round(elapsed)} seconds ago` : `rates measured ${Math.round(elapsed)} seconds ago, before the craft enters ${horizon.enters}`
    };
  }
  return elapsed;
}
function reckonResourceLevels(observed, lifeSupport, reckonUt, profile, orbit, bodies) {
  if (observed == null) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no resource levels observed"
      }
    };
  }
  if (lifeSupport == null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport",
        note: "no Kerbalism rates for this craft"
      }
    };
  }
  const rates = ratesWithWear(lifeSupport, profile);
  if (rates === null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport#rates"
      }
    };
  }
  const asOfUt = magnitudeOf2(lifeSupport.asOfKerbalismUt);
  if (asOfUt === null) {
    return {
      declined: {
        reason: "input-absent",
        input: "@kerbalism.lifesupport#asOfUt",
        note: "Kerbalism evaluation time unreadable"
      }
    };
  }
  const elapsed = intervalOrDecline(
    asOfUt,
    reckonUt,
    rateHorizon(orbit, bodies, asOfUt)
  );
  if (typeof elapsed !== "number") return { declined: elapsed };
  const rated = movingLevels(observed, lifeSupport, rates, profile, asOfUt);
  if (rated.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no resource aboard is changing"
      }
    };
  }
  const moving = rated.filter((level) => reckonUt < level.crossesAtUt);
  if (moving.length === 0) {
    const last = rated.reduce(
      (a, b) => a.crossesAtUt >= b.crossesAtUt ? a : b
    );
    return {
      declined: {
        reason: "beyond-horizon",
        input: "@kerbalism.lifesupport#rates",
        note: `${last.name} ${last.boundary === "floor" ? "empty" : "full"} at UT ${Math.round(last.crossesAtUt)}`
      }
    };
  }
  const modelled = [
    { path: "", basis: "rate-integration" },
    ...moving.map(({ name }) => ({
      path: `resources.${name}.current`,
      basis: "rate-integration"
    }))
  ];
  return {
    modelled,
    reckon: (at) => {
      const resources = { ...observed.resources };
      for (const { name, current, segments, crossesAtUt } of moving) {
        if (at >= crossesAtUt) continue;
        resources[name] = {
          ...observed.resources[name],
          current: value("units", levelAt(current, segments, at))
        };
      }
      return { ...observed, resources };
    }
  };
}
function readingValue(reading) {
  return reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
}
KERBALISM.registerReckoner("vessel.resources", {
  deps: [
    KERBALISM_LIFESUPPORT_TOPIC,
    { reading: KERBALISM_PROFILE_TOPIC },
    { reading: "vessel.orbit" },
    { reading: "trackingStation.bodies" }
  ],
  reckon: (point, [lifeSupportPoint, profile, orbit, bodies], { reckonUt }) => reckonResourceLevels(
    point.payload,
    lifeSupportPoint?.payload,
    reckonUt,
    profile.state === "observed" || profile.state === "held" ? profile.value : void 0,
    readingValue(orbit),
    readingValue(bodies)
  )
});

// src/processor.ts
var levelHistory = new LevelHistory();
var SHIP_SYSTEMS = KERBALISM.registerProcessor({
  id: "ship-systems",
  deps: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    // A READING, not the payload. Every figure this derivation produces is a
    // function of the resource levels, so whether those levels are current is
    // part of the answer rather than a detail a consumer can look up
    // separately. It also carries the observation's own UT.
    { reading: "vessel.resources" },
    "vessel.crew"
  ],
  compute: ([profile, lifeSupport, resourcesReading, crew]) => {
    const resources = resourcesReading.state === "observed" || resourcesReading.state === "held" ? resourcesReading.value : void 0;
    const observedAtUt = observedAt(resourcesReading);
    const stored = {};
    const capacity = {};
    const levels = resources?.resources ?? {};
    for (const [name, amount] of Object.entries(levels)) {
      stored[name] = magnitudeOr2(amount.current, 0);
      capacity[name] = magnitudeOr2(amount.max, 0);
    }
    const crewCount = magnitudeOr2(crew?.count, 0);
    const moved = movedLevels(resourcesReading);
    const crossings = {};
    for (const c of resourceBoundaryCrossings(
      resources ?? null,
      lifeSupport,
      profile
    )) {
      crossings[c.resource] = {
        boundary: c.boundary,
        atUt: c.atUt.magnitude
      };
    }
    if (observedAtUt !== void 0) {
      levelHistory.record(observedAtUt.magnitude, stored);
      for (const [name, level] of Object.entries(stored)) {
        if (lifeSupport?.rates?.[name] === void 0) continue;
        const reconciled = reconcileCrossing(
          crossings[name] ?? null,
          levelHistory.trend(name, capacity[name] ?? 0),
          {
            current: level,
            capacity: capacity[name] ?? 0,
            ut: observedAtUt.magnitude
          }
        );
        if (reconciled === null) delete crossings[name];
        else crossings[name] = reconciled;
      }
    }
    const figures = deriveReading(
      resourcesReading,
      (observed) => levelFigures(observed, () => true),
      (modelled) => moved.size === 0 ? void 0 : levelFigures(modelled, (name) => moved.has(name))
    );
    return {
      summary: summarise({
        profile,
        lifeSupport,
        stored,
        capacity,
        crew: crewCount,
        crossings
      }),
      profile,
      lifeSupport,
      crew: crewCount,
      levels: {
        state: resourcesReading.state,
        asOfUt: observedAtUt
      },
      figures
    };
  }
});
function movedLevels(reading) {
  const moved = /* @__PURE__ */ new Set();
  if (reading.state !== "observed" && reading.state !== "held") return moved;
  if (reading.reckoning.status !== "available") return moved;
  for (const { path } of reading.reckoning.modelled) {
    const match = /^resources\.(.+)\.current$/.exec(path);
    if (match?.[1] !== void 0) moved.add(match[1]);
  }
  return moved;
}
function levelFigures(payload, include) {
  const figures = {};
  for (const [name, amount] of Object.entries(payload.resources ?? {})) {
    if (!include(name)) continue;
    figures[name] = { amount: magnitudeOr2(amount.current, 0) };
  }
  return figures;
}

// src/ShipSystems/index.tsx
import {
  AugmentSlot,
  combineReadings,
  registerComponent,
  useProcessor,
  useTelemetry as useTelemetry2,
  useUtNow,
  value as value3
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge3,
  Card,
  Cluster as Cluster4,
  Disclosure,
  DivergingBar,
  Divider,
  EmptyState,
  Grid,
  Meter,
  MeterStack,
  ModelledAlongside,
  magnitudeOf as magnitudeOf5,
  magnitudeOr as magnitudeOr3,
  modelledBeyondReceived,
  Notice,
  NULL_DISPLAY as NULL_DISPLAY2,
  Panel,
  Section as Section2,
  Stack as Stack3,
  speakQuantity,
  standsApart,
  Text as Text3,
  Unit as Unit3,
  writtenAs
} from "@ksp-gonogo/ui-kit";
import { createContext, useContext, useMemo as useMemo2 } from "react";

// src/ShipSystems/GreenhouseSection.tsx
import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  kspCalendar,
  NULL_DISPLAY,
  Section,
  Stack,
  Text
} from "@ksp-gonogo/ui-kit";
import { jsx, jsxs } from "react/jsx-runtime";
function fmtWm2(n) {
  return n === null ? NULL_DISPLAY : `${Math.round(n)} W/m\xB2`;
}
function fmtRatePerDay(perSec) {
  if (perSec === null) return NULL_DISPLAY;
  if (perSec <= 0) return "0/day";
  const perDay = perSec * kspCalendar().day;
  return `${perDay >= 10 ? perDay.toFixed(0) : perDay.toFixed(2)}/day`;
}
function greenhouseTone(g, tooHigh) {
  if (!g.active) return void 0;
  return g.issue.length > 0 || tooHigh ? "warn" : void 0;
}
function greenhouseStateLabel(g, tooHigh) {
  if (!g.active) return "Off";
  if (tooHigh) return "Halted";
  return g.issue.length > 0 ? "Blocked" : "Growing";
}
function radiationTooHigh(g, ambientRadiationRadPerSecond) {
  return g.radiationToleranceRadPerSec > 0 && ambientRadiationRadPerSecond > g.radiationToleranceRadPerSec;
}
function GreenhouseEntryRow({
  g,
  titlePrefix,
  ambientRadiationRadPerSecond,
  held
}) {
  const blocked = g.active && g.issue.length > 0;
  const tooHigh = radiationTooHigh(g, ambientRadiationRadPerSecond);
  return /* @__PURE__ */ jsxs(Section, { children: [
    /* @__PURE__ */ jsxs(Cluster, { justify: "between", children: [
      /* @__PURE__ */ jsx(Text, { level: "muted", size: "xs", children: titlePrefix.toUpperCase() }),
      /* @__PURE__ */ jsxs(Cluster, { justify: "end", wrap: true, children: [
        tooHigh && // `warning`, not `critical`: recoverable once the storm passes,
        // the same rung the host widget's Degraded status uses for it
        // (see this file's doc comments).
        /* @__PURE__ */ jsx(Badge, { role: "status", "aria-live": "polite", tone: "warn", size: "sm", children: "Radiation too high" }),
        held ? /* @__PURE__ */ jsx(Badge, { role: "status", "aria-live": "polite", tone: "info", size: "sm", children: "held" }) : /* @__PURE__ */ jsx(
          Badge,
          {
            role: "status",
            "aria-live": "polite",
            tone: greenhouseTone(g, tooHigh),
            size: "sm",
            children: greenhouseStateLabel(g, tooHigh)
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Text, { level: held ? "muted" : void 0, size: "xs", children: [
      held ? "At last contact: " : "",
      "Natural ",
      fmtWm2(g.natural),
      " \xB7 Artificial ",
      fmtWm2(g.artificial),
      " \xB7 Rate",
      " ",
      fmtRatePerDay(g.foodRatePerSec)
    ] }),
    blocked && /* @__PURE__ */ jsx(Text, { tone: "warn", size: "xs", children: g.issue })
  ] });
}
function GreenhouseSection({
  greenhouses,
  ambientRadiationRadPerSecond,
  held
}) {
  if (greenhouses.length === 0) return null;
  if (greenhouses.length === 1) {
    return /* @__PURE__ */ jsx(Stack, { children: /* @__PURE__ */ jsx(
      GreenhouseEntryRow,
      {
        g: greenhouses[0],
        titlePrefix: "Greenhouse",
        ambientRadiationRadPerSecond,
        held
      }
    ) });
  }
  return /* @__PURE__ */ jsxs(Stack, { children: [
    /* @__PURE__ */ jsx(Text, { level: "muted", size: "xs", children: "GREENHOUSES" }),
    greenhouses.map((g, i) => /* @__PURE__ */ jsx(
      GreenhouseEntryRow,
      {
        g,
        titlePrefix: g.cropResource,
        ambientRadiationRadPerSecond,
        held
      },
      `${g.cropResource}-${i}`
    ))
  ] });
}
registerAugment({
  id: "life-support-greenhouse",
  augments: "ship-systems.life-support",
  component: GreenhouseSection,
  owner: KERBALISM
});

// src/ShipSystems/RadiationSection.tsx
import { value as value2 } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster as Cluster3,
  Graph,
  magnitudeOf as magnitudeOf4,
  Stack as Stack2,
  Text as Text2,
  Unit as Unit2
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";

// src/CrewSurvival/summary.tsx
import { registerAugment as registerAugment2, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge2,
  Cluster as Cluster2,
  magnitudeOf as magnitudeOf3,
  ReadoutCaption,
  Unit
} from "@ksp-gonogo/ui-kit";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var HIGH_RADIATION_RAD_PER_HOUR = 0.5;
function radiationSummaryFor(weather) {
  if (!weather) return null;
  if (weather.stormInProgress === true) {
    return { label: "Radiation storm in progress", severity: "nogo" };
  }
  const doseRadPerSecond = magnitudeOf3(
    weather.habitatRadiationRadPerSecond ?? weather.radiationRadPerSecond
  );
  if (doseRadPerSecond === null) return null;
  const doseRadPerHour = doseRadPerSecond * 3600;
  if (doseRadPerHour >= HIGH_RADIATION_RAD_PER_HOUR) {
    return { label: "High radiation environment", severity: "warn" };
  }
  return null;
}
function CrewRadiationSummaryAugment(_props) {
  const weatherReading = useTelemetry("kerbalism.spaceweather");
  const weather = weatherReading.state === "observed" ? weatherReading.value : void 0;
  const summary = radiationSummaryFor(weather);
  if (!summary) return null;
  const doseValue = weather?.habitatRadiationRadPerSecond ?? weather?.radiationRadPerSecond;
  return /* @__PURE__ */ jsxs2(
    Cluster2,
    {
      wrap: true,
      align: "center",
      role: "status",
      "aria-live": "polite",
      "aria-label": "crew radiation status",
      children: [
        /* @__PURE__ */ jsx2(Badge2, { tone: summary.severity, size: "sm", children: summary.label }),
        doseValue && /* @__PURE__ */ jsx2(ReadoutCaption, { children: /* @__PURE__ */ jsx2(Unit, { value: doseValue }) })
      ]
    }
  );
}
registerAugment2({
  id: "crew-status-radiation-summary",
  augments: "crew-status.summary",
  component: CrewRadiationSummaryAugment,
  requires: "kerbalism",
  owner: KERBALISM
});

// src/ShipSystems/RadiationSection.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var RADIATION_WINDOW_SEC = 600;
var MIN_SAMPLE_GAP_UT = 2;
function pushRadiationSample(buffer, sample, windowSec = RADIATION_WINDOW_SEC, minGapUt = MIN_SAMPLE_GAP_UT) {
  if (sample.ambientRadPerSec === null && sample.shieldedRadPerSec === null) {
    return buffer;
  }
  const last = buffer[buffer.length - 1];
  if (last) {
    if (sample.ut < last.ut - minGapUt) return [sample];
    if (sample.ut - last.ut < minGapUt) return buffer;
  }
  const next = [...buffer, sample];
  const cutoff = sample.ut - windowSec;
  const start = next.findIndex((s) => s.ut >= cutoff);
  return start <= 0 ? next : next.slice(start);
}
function useRadiationHistory(weather, utNow) {
  const [history, setHistory] = useState([]);
  const ambientRadPerSec = magnitudeOf4(weather?.radiationRadPerSecond);
  const shieldedRadPerSec = magnitudeOf4(
    weather?.habitatRadiationRadPerSecond ?? weather?.radiationRadPerSecond
  );
  const hasWeather = weather !== void 0;
  useEffect(() => {
    if (!hasWeather || utNow === void 0) return;
    setHistory(
      (prev) => pushRadiationSample(prev, {
        ut: utNow,
        ambientRadPerSec,
        shieldedRadPerSec
      })
    );
  }, [hasWeather, utNow, ambientRadPerSec, shieldedRadPerSec]);
  return history;
}
var RAD_PER_SEC_TO_RAD_PER_HOUR = 3600;
function toRadPerHourSeries(history, pick) {
  const points = [];
  const breaks = [];
  let dropped = false;
  for (const s of history) {
    const radPerSec = pick(s);
    if (radPerSec === null) {
      dropped = true;
      continue;
    }
    if (dropped && points.length > 0) breaks.push(points.length);
    dropped = false;
    points.push({ x: s.ut, y: radPerSec * RAD_PER_SEC_TO_RAD_PER_HOUR });
  }
  return { points, breaks };
}
function chartData(trace) {
  return {
    x: trace.points.map((p) => p.x),
    y: trace.points.map((p) => p.y / RAD_PER_SEC_TO_RAD_PER_HOUR),
    breaks: trace.breaks
  };
}
function niceCeil(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(v));
  const mantissa = v / base;
  for (const step of [1, 2, 2.5, 5]) {
    if (mantissa <= step) return step * base;
  }
  return 10 * base;
}
function doseRateDecimals(radPerHour) {
  const abs = Math.abs(radPerHour);
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  if (abs >= 1) return 2;
  return 3;
}
function locationLabel(weather) {
  const labels = [];
  if (weather.innerBelt === true) labels.push("Inner belt");
  if (weather.outerBelt === true) labels.push("Outer belt");
  if (labels.length === 0) {
    labels.push(weather.magnetosphere === true ? "Magnetosphere" : "None");
  }
  return labels.join(" \xB7 ");
}
function RadiationSection({ weather, utNow }) {
  const history = useRadiationHistory(weather, utNow);
  if (!weather) return null;
  const hasTrend = history.length >= 2;
  const location = locationLabel(weather);
  const ambientRadPerSec = magnitudeOf4(weather.radiationRadPerSecond);
  const shieldedRadPerSec = magnitudeOf4(
    weather.habitatRadiationRadPerSecond ?? weather.radiationRadPerSecond
  );
  const ambientValue = ambientRadPerSec === null ? null : value2("rad/s", ambientRadPerSec);
  const shieldedValue = shieldedRadPerSec === null ? null : value2("rad/s", shieldedRadPerSec);
  const ambientRadPerHour = ambientRadPerSec === null ? null : ambientRadPerSec * RAD_PER_SEC_TO_RAD_PER_HOUR;
  const shieldedRadPerHour = shieldedRadPerSec === null ? null : shieldedRadPerSec * RAD_PER_SEC_TO_RAD_PER_HOUR;
  const ambientHigh = ambientRadPerHour !== null && ambientRadPerHour > HIGH_RADIATION_RAD_PER_HOUR;
  const shieldedHigh = shieldedRadPerHour !== null && shieldedRadPerHour > HIGH_RADIATION_RAD_PER_HOUR;
  const ambient = toRadPerHourSeries(history, (s) => s.ambientRadPerSec);
  const shielded = toRadPerHourSeries(history, (s) => s.shieldedRadPerSec);
  const ambientPoints = ambient.points;
  const shieldedPoints = shielded.points;
  const series = [
    {
      id: "ambient",
      label: "Ambient",
      axis: "primary",
      color: ambientHigh ? "var(--color-warn-mark)" : "var(--color-text-muted)",
      data: chartData(ambient)
    },
    {
      id: "shielded",
      label: "Shielded",
      axis: "primary",
      color: shieldedHigh ? "var(--color-nogo-mark)" : "var(--color-info-mark)",
      data: chartData(shielded)
    }
  ];
  const allPoints = [...ambientPoints, ...shieldedPoints];
  const xDomain = allPoints.length === 0 ? [0, 1] : [
    Math.min(...allPoints.map((p) => p.x)),
    Math.max(...allPoints.map((p) => p.x))
  ];
  const dataMaxRadPerHour = Math.max(
    ambientRadPerHour ?? 0,
    shieldedRadPerHour ?? 0,
    ...ambientPoints.map((p) => p.y),
    ...shieldedPoints.map((p) => p.y)
  );
  const yMax = niceCeil(
    Math.max(dataMaxRadPerHour, HIGH_RADIATION_RAD_PER_HOUR * 2)
  );
  return (
    // No Card, no side-by-side badge column: the graph is OPEN and spans
    // the widget's full width (see the header doc comment). Belt/location
    // moved below as plain low-emphasis text; `role="status"` stays on that
    // text (not a Stack of badges) since it is still the one bit of this
    // section that changes without the operator watching for it.
    /* @__PURE__ */ jsxs3(Stack2, { children: [
      /* @__PURE__ */ jsx3(
        Graph,
        {
          chrome: "bare",
          density: "compact",
          hideXAxis: true,
          series,
          xDomain,
          yDomainPrimary: [0, yMax / RAD_PER_SEC_TO_RAD_PER_HOUR],
          yUnit: "rad/s",
          thresholds: [
            {
              id: "safe",
              label: "Safe threshold",
              kind: "marker",
              value: value2(
                "rad/s",
                HIGH_RADIATION_RAD_PER_HOUR / RAD_PER_SEC_TO_RAD_PER_HOUR
              )
            }
          ],
          notice: hasTrend ? void 0 : "Collecting radiation history...",
          height: 96,
          "aria-label": "Radiation dose rate trend: ambient versus shielded, last 10 minutes"
        }
      ),
      /* @__PURE__ */ jsxs3(Cluster3, { justify: "between", style: { marginTop: "var(--gap-caption)" }, children: [
        /* @__PURE__ */ jsxs3(Text2, { tone: ambientHigh ? "warn" : void 0, size: "xs", children: [
          "Ambient",
          " ",
          /* @__PURE__ */ jsx3(
            Unit2,
            {
              value: ambientValue,
              decimals: doseRateDecimals(ambientRadPerHour ?? 0)
            }
          )
        ] }),
        /* @__PURE__ */ jsxs3(Text2, { tone: shieldedHigh ? "nogo" : "info", size: "xs", children: [
          "Shielded",
          " ",
          /* @__PURE__ */ jsx3(
            Unit2,
            {
              value: shieldedValue,
              decimals: doseRateDecimals(shieldedRadPerHour ?? 0)
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsx3(Text2, { level: "muted", size: "xs", role: "status", "aria-live": "polite", children: location })
    ] })
  );
}

// src/ShipSystems/resourceColorMap.ts
import { resourceColor } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
var KEY_SEPARATOR = "\0";
function useResourceColorMap(names) {
  const memberKey = useMemo(
    () => [...new Set(names)].sort().join(KEY_SEPARATOR),
    [names]
  );
  return useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    if (memberKey.length === 0) return map;
    for (const name of memberKey.split(KEY_SEPARATOR)) {
      map.set(name, resourceColor(name));
    }
    return map;
  }, [memberKey]);
}

// src/ShipSystems/index.tsx
import { Fragment, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var SOON_EMPTY_SEC = 600;
function fill(fraction) {
  return fraction === null ? null : value3("ratio", fraction);
}
function fmtAmt(n) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 0.05 && !(rounded === 0 && n !== 0)) {
    return String(rounded);
  }
  return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}
function formatTimeToEmpty(sec) {
  if (sec == null || !Number.isFinite(sec)) return "steady";
  return speakQuantity(value3("s", Math.max(0, sec)));
}
function formatRate(perSecond) {
  if (!Number.isFinite(perSecond) || perSecond === 0) return "0/s";
  const sign = perSecond > 0 ? "+" : "";
  return `${sign}${fmtAmt(perSecond)}/s`;
}
function toneForRow(row, utNow) {
  if (row.role === "root") return "nogo";
  const emptyIn = secondsToFloor(row, utNow);
  if (emptyIn !== null && emptyIn < SOON_EMPTY_SEC) return "nogo";
  if (row.belowLowThreshold === true) return "warn";
  if (row.role === "downstream") return "warn";
  if (emptyIn !== null && row.fraction !== null && row.fraction < 0.2) {
    return "warn";
  }
  return "neutral";
}
function modelledRow(row, modelled) {
  const figure = modelled?.[row.name];
  if (figure === void 0 || row.capacity <= 0) return {};
  return { amount: figure.amount };
}
function secondsToCrossing(row, utNow) {
  if (row.crossing === null || utNow === void 0) return null;
  const seconds2 = row.crossing.atUt - utNow;
  return Number.isFinite(seconds2) ? seconds2 : null;
}
function secondsToFloor(row, utNow) {
  return row.crossing?.boundary === "floor" ? secondsToCrossing(row, utNow) : null;
}
function crossingWord(row) {
  return row.crossing?.boundary === "ceiling" ? "full" : "empty";
}
function isStable(row) {
  return row.crossing === null && row.ratePerSecond === 0;
}
function crossingSpoken(row, utNow) {
  const seconds2 = secondsToCrossing(row, utNow);
  if (seconds2 === null) return isStable(row) ? "stable" : null;
  const word = crossingWord(row);
  return seconds2 > 0 ? `${word} in ${speakQuantity(value3("s", seconds2))}, modelled` : `modelled ${word} by now`;
}
function rowValueLabel(row, utNow, modelled = {}) {
  if (row.capacity <= 0) return "not fitted";
  const crossing = crossingSpoken(row, utNow);
  const reckoned = modelled.amount !== void 0 && standsApart(row.amount, modelled.amount, writtenAs(fmtAmt)) ? `, modelled to SCET ${fmtAmt(modelled.amount)}` : "";
  return `${fmtAmt(row.amount)} / ${fmtAmt(row.capacity)}${reckoned}${crossing === null ? "" : ` \xB7 ${crossing}`}`;
}
function RowValueDisplay({
  row,
  modelled = {}
}) {
  if (row.capacity <= 0) return /* @__PURE__ */ jsx4(Fragment, { children: "not fitted" });
  return /* @__PURE__ */ jsxs4(Fragment, { children: [
    fmtAmt(row.amount),
    /* @__PURE__ */ jsx4(
      ModelledAlongside,
      {
        observed: row.amount,
        modelled: modelled.amount,
        write: fmtAmt
      }
    ),
    " / ",
    fmtAmt(row.capacity),
    /* @__PURE__ */ jsx4(CrossingTime, { row, lead: " \xB7 " })
  ] });
}
function CrossingTime({
  row,
  lead = "",
  approx = false
}) {
  const ledger = useContext(LedgerReadingContext);
  const utNow = useContext(ViewUtContext);
  const seconds2 = secondsToCrossing(row, utNow);
  if (seconds2 === null) return isStable(row) ? /* @__PURE__ */ jsxs4(Fragment, { children: [
    lead,
    "stable"
  ] }) : null;
  const word = crossingWord(row);
  if (seconds2 <= 0) {
    return /* @__PURE__ */ jsxs4(Fragment, { children: [
      lead,
      "modelled ",
      word,
      " by now"
    ] });
  }
  const left = value3("s", seconds2);
  return /* @__PURE__ */ jsxs4(Fragment, { children: [
    lead,
    word,
    " in ",
    approx ? "~" : "",
    /* @__PURE__ */ jsx4(Unit3, { value: ledger ? combineReadings([ledger], () => left) : left }),
    ", modelled"
  ] });
}
var LedgerReadingContext = createContext(
  void 0
);
var ViewUtContext = createContext(void 0);
function wearTone(w, utNow) {
  const seconds2 = secondsToCrossing(w, utNow);
  if (seconds2 !== null && seconds2 < SOON_EMPTY_SEC) {
    return "nogo";
  }
  if (w.fraction !== null && w.fraction < 0.2) return "warn";
  return "neutral";
}
function wearValueLabel(w, utNow) {
  if (w.capacity <= 0) return "not fitted";
  const level = `${fmtAmt(w.amount)} / ${fmtAmt(w.capacity)}`;
  if (w.drainPerSecond === null) return level;
  if (w.drainPerSecond === 0) return `${level} \xB7 stable`;
  return `${level} \xB7 ${formatTimeToEmpty(secondsToCrossing(w, utNow))}`;
}
function toProcessRow(p, index) {
  return {
    id: p.resource || p.title || `process-${index}`,
    name: p.title || p.resource || "Process",
    state: p.broken === true ? "broken" : p.running === true ? "running" : p.broken == null || p.running == null ? "unknown" : "idle"
  };
}
function processSeverity(state) {
  if (state === "broken") return "nogo";
  return state === "unknown" ? "warn" : void 0;
}
function toGreenhouseRow(g) {
  return {
    cropResource: g.cropResource || "Food",
    natural: magnitudeOf5(g.natural),
    artificial: magnitudeOf5(g.artificial),
    // Unreachable today rather than justified: no producer fills `greenhouses`
    // at all (the contract says so on the field), so this coerces nothing. It
    // needs revisiting the day the capture starts emitting them.
    active: g.active ?? false,
    issue: g.issue ?? "",
    radiationToleranceRadPerSec: magnitudeOr3(g.radiationToleranceRadPerSec, 0),
    foodRatePerSec: magnitudeOf5(g.foodRatePerSec)
  };
}
function ShipSystemsComponent(_props) {
  const shipReading = useProcessor(SHIP_SYSTEMS);
  const ship = shipReading?.state === "observed" || shipReading?.state === "held" ? shipReading.value : void 0;
  const weatherReading = useTelemetry2("kerbalism.spaceweather");
  const weather = weatherReading.state === "observed" ? weatherReading.value : void 0;
  const utNow = useUtNow();
  if (!ship) {
    return /* @__PURE__ */ jsx4(
      Panel,
      {
        panelTitle: "Ship Systems",
        sections: /* @__PURE__ */ jsx4(Section2, { full: true, children: /* @__PURE__ */ jsx4(EmptyState, { layout: "fill", role: "status", "aria-live": "polite", children: "Waiting for Kerbalism telemetry..." }) })
      }
    );
  }
  const { summary } = ship;
  const hasAnyResource = summary.supplies.length > 0 || summary.other.length > 0 || summary.wear.length > 0;
  if (!hasAnyResource) {
    return /* @__PURE__ */ jsx4(
      Panel,
      {
        panelTitle: "Ship Systems",
        sections: /* @__PURE__ */ jsx4(Section2, { full: true, children: /* @__PURE__ */ jsx4(EmptyState, { layout: "fill", role: "status", "aria-live": "polite", children: "No Kerbalism profile reported for this vessel yet." }) })
      }
    );
  }
  return /* @__PURE__ */ jsx4(LedgerReadingContext.Provider, { value: shipReading, children: /* @__PURE__ */ jsx4(ViewUtContext.Provider, { value: utNow, children: /* @__PURE__ */ jsx4(
    ShipSystemsBody,
    {
      ship,
      weather,
      utNow,
      held: shipReading?.state === "held",
      modelled: modelledBeyondReceived(ship.figures)
    }
  ) }) });
}
function overallStatus(ship, utNow, anyGreenhouseHalted) {
  if (ship.summary.causes.length > 0)
    return { label: "Critical", tone: "nogo" };
  const tones = ship.summary.supplies.map((row) => toneForRow(row, utNow));
  if (tones.includes("nogo")) return { label: "Critical", tone: "nogo" };
  if (tones.includes("warn") || anyGreenhouseHalted)
    return { label: "Degraded", tone: "warn" };
  return { label: "Nominal", tone: "go" };
}
function ShipSystemsBody({
  ship,
  weather,
  utNow,
  held,
  modelled
}) {
  const { summary } = ship;
  const rowsByDisplayName = new Map(
    [...summary.supplies, ...summary.other].map((r) => [r.displayName, r])
  );
  const habitat = ship.lifeSupport?.habitat;
  const processes = (ship.lifeSupport?.processes ?? []).map(toProcessRow);
  const greenhouses = (ship.lifeSupport?.greenhouses ?? []).map(
    toGreenhouseRow
  );
  const ambientRadiationRadPerSecond = magnitudeOr3(
    weather?.radiationRadPerSecond,
    0
  );
  const ecRow = summary.supplies.find((r) => r.name === "ElectricCharge") ?? summary.other.find((r) => r.name === "ElectricCharge");
  const runningCount = processes.filter((p) => p.state === "running").length;
  const brokenCount = processes.filter((p) => p.state === "broken").length;
  const unknownCount = processes.filter((p) => p.state === "unknown").length;
  const processSummary = brokenCount > 0 ? `${runningCount} running \xB7 ${brokenCount} broken` : unknownCount > 0 ? `${runningCount} running \xB7 ${unknownCount} unread` : `${runningCount} / ${processes.length} running`;
  const pressureRatio = magnitudeOf5(habitat?.pressure);
  const pressurized = pressureRatio === null ? null : pressureRatio > 0.5;
  const comfort = magnitudeOf5(habitat?.comfort);
  const poisoning = magnitudeOf5(habitat?.poisoning);
  const anyGreenhouseHalted = greenhouses.some(
    (g) => radiationTooHigh(g, ambientRadiationRadPerSecond)
  );
  const status = overallStatus(ship, utNow, anyGreenhouseHalted);
  const resourceColors = useResourceColorMap([
    ...summary.supplies.map((r) => r.name),
    ...summary.other.map((r) => r.name)
  ]);
  return /* @__PURE__ */ jsx4(
    Panel,
    {
      panelTitle: "Ship Systems",
      panelAside: /* @__PURE__ */ jsx4(Badge3, { role: "status", "aria-live": "polite", tone: status.tone, children: held ? `${status.label} \xB7 held` : status.label }),
      panelFooter: (
        // The power footer, PINNED below the scroller by the Panel itself
        // (not merely rendered last, which still scrolled away with the
        // body): ElectricCharge is universal across every Kerbalism profile,
        // so it earns the one permanently visible readout, the same
        // "duplicate the balance next to where it matters" convention the
        // funds rule uses. Rendered only when the profile carries EC.
        ecRow && /* @__PURE__ */ jsx4(
          Meter,
          {
            label: "Power",
            value: fill(ecRow.fraction),
            tone: toneForRow(ecRow, utNow),
            valueLabel: rowValueLabel(
              ecRow,
              utNow,
              modelledRow(ecRow, modelled)
            ),
            valueLabelNode: /* @__PURE__ */ jsx4(
              RowValueDisplay,
              {
                row: ecRow,
                modelled: modelledRow(ecRow, modelled)
              }
            )
          }
        )
      ),
      sections: [
        /* Radiation leads the widget: the operator's own call, it is the
           attractive visual (the sparkline trend), so it earns the top
           slot rather than sitting below the resource ledger, and it spans
           because a trend reads wide. Renders nothing when no spaceweather
           frame has ever landed, matching RadiationSection's own contract. */
        weather && /* @__PURE__ */ jsxs4(Section2, { full: true, children: [
          /* @__PURE__ */ jsx4(SectionHead, { label: "Radiation" }),
          /* @__PURE__ */ jsx4(RadiationSection, { weather, utNow })
        ] }, "radiation"),
        summary.causes.length > 0 && /* Spans, like any warning the sections below it are qualified by.
        
                     A Notice rather than a Card: this is a statement ABOUT the
                     sections below it, not a record among them, and it is announced
                     when it appears. The announcement contract is the component's, so
                     this site no longer carries a hand-written role and aria-live. */
        /* @__PURE__ */ jsx4(Section2, { full: true, children: /* @__PURE__ */ jsx4(Notice, { tone: "nogo", title: "Limiting factors", children: /* @__PURE__ */ jsx4(Stack3, { gap: "caption", children: summary.causes.flatMap(
          (cause) => cause.explains.length > 0 ? cause.explains.map((explained) => {
            const explainedRow = rowsByDisplayName.get(explained);
            return /* @__PURE__ */ jsx4(
              Text3,
              {
                tone: "nogo",
                size: "xs",
                children: /* @__PURE__ */ jsx4(
                  LimitedByMessage,
                  {
                    subjectDisplayName: explained,
                    blockedBy: [cause.displayName],
                    row: explainedRow
                  }
                )
              },
              `${cause.name}-${explained}`
            );
          }) : [
            /* @__PURE__ */ jsxs4(Text3, { tone: "nogo", size: "xs", children: [
              cause.displayName,
              " is running critically low",
              secondsToFloor(cause, utNow) !== null && /* @__PURE__ */ jsxs4(Fragment, { children: [
                " (",
                /* @__PURE__ */ jsx4(CrossingTime, { row: cause, approx: true }),
                ")"
              ] })
            ] }, cause.name)
          ]
        ) }) }) }, "causes"),
        /* @__PURE__ */ jsxs4(Section2, { children: [
          /* @__PURE__ */ jsx4(SectionHead, { label: "Supplies" }),
          /* @__PURE__ */ jsx4(MeterStack, { children: summary.supplies.map((row) => /* @__PURE__ */ jsx4(
            ResourceLedgerRow,
            {
              row,
              ship,
              modelled: modelledRow(row, modelled),
              identityColor: resourceColors.get(row.name)
            },
            row.name
          )) })
        ] }, "supplies"),
        summary.other.length > 0 && /* @__PURE__ */ jsxs4(Section2, { children: [
          /* @__PURE__ */ jsx4(SectionHead, { label: "Other resources" }),
          /* @__PURE__ */ jsx4(MeterStack, { children: summary.other.map((row) => /* @__PURE__ */ jsx4(
            ResourceLedgerRow,
            {
              row,
              ship,
              modelled: modelledRow(row, modelled),
              identityColor: resourceColors.get(row.name)
            },
            row.name
          )) })
        ] }, "other"),
        summary.wear.length > 0 && /* @__PURE__ */ jsxs4(Section2, { children: [
          /* @__PURE__ */ jsx4(SectionHead, { label: "Wear" }),
          /* @__PURE__ */ jsx4(MeterStack, { children: summary.wear.map((w) => /* @__PURE__ */ jsx4(
            Meter,
            {
              label: w.process,
              value: fill(w.fraction),
              tone: wearTone(w, utNow),
              valueLabel: wearValueLabel(w, utNow)
            },
            w.name
          )) })
        ] }, "wear"),
        /* @__PURE__ */ jsxs4(Section2, { children: [
          /* @__PURE__ */ jsx4(
            SectionHead,
            {
              label: "Habitat",
              value: pressurized === null ? NULL_DISPLAY2 : pressurized ? "Pressurized" : "Unpressurized",
              tone: pressurized === null ? "neutral" : pressurized ? "go" : "warn"
            }
          ),
          /* @__PURE__ */ jsxs4(Grid, { minColWidth: "10rem", gap: "related-comfortable", children: [
            /* @__PURE__ */ jsx4(
              Meter,
              {
                label: "Comfort",
                value: fill(comfort),
                tone: comfort !== null && comfort < 0.25 ? "warn" : "neutral"
              }
            ),
            /* @__PURE__ */ jsx4(
              Meter,
              {
                label: "Living space",
                value: fill(magnitudeOf5(habitat?.livingSpace)),
                tone: "neutral"
              }
            ),
            /* @__PURE__ */ jsx4(
              Meter,
              {
                label: "CO2 poisoning",
                value: fill(poisoning),
                tone: poisoning !== null && poisoning >= 0.5 ? "nogo" : "neutral"
              }
            )
          ] })
        ] }, "habitat"),
        /* @__PURE__ */ jsxs4(Section2, { children: [
          /* @__PURE__ */ jsx4(
            SectionHead,
            {
              label: "Processes",
              value: held ? "run state held" : processSummary,
              tone: held ? void 0 : brokenCount > 0 ? "nogo" : unknownCount > 0 ? "warn" : "go"
            }
          ),
          /* @__PURE__ */ jsx4(Stack3, { children: processes.map((p) => /* @__PURE__ */ jsxs4(Cluster4, { justify: "between", children: [
            /* @__PURE__ */ jsx4(Text3, { size: "xs", children: p.name }),
            held ? /* @__PURE__ */ jsx4(Badge3, { tone: "info", size: "sm", children: "held" }) : /* @__PURE__ */ jsx4(Badge3, { tone: processSeverity(p.state), size: "sm", children: p.state })
          ] }, p.id)) })
        ] }, "processes"),
        /* This package's own GreenhouseSection fills this slot, self-registering
           into `ship-systems.life-support` via the side-effect import above.
           `AugmentSlot` renders a fragment, so each bound augment becomes its
           own item of the section grid and flows beside the host's sections. */
        /* @__PURE__ */ jsx4(
          AugmentSlot,
          {
            name: "ship-systems.life-support",
            props: { greenhouses, ambientRadiationRadPerSecond, held }
          },
          "life-support"
        )
      ]
    }
  );
}
function SectionHead({
  label,
  value: value11,
  tone
}) {
  return /* @__PURE__ */ jsxs4(Cluster4, { justify: "between", align: "baseline", children: [
    /* @__PURE__ */ jsx4(Text3, { level: "muted", size: "xs", children: label.toUpperCase() }),
    value11 !== void 0 && // `neutral` is a Meter/Badge tone, not a Text one: a resting
    // section reading renders in the same muted text as the label.
    /* @__PURE__ */ jsx4(
      Text3,
      {
        tone: tone === void 0 || tone === "neutral" ? void 0 : tone,
        level: "muted",
        size: "xs",
        children: value11
      }
    )
  ] });
}
function ResourceLedgerRow({
  row,
  ship,
  modelled,
  identityColor
}) {
  const utNow = useContext(ViewUtContext);
  const ledger = useMemo2(
    () => buildLedger({
      resource: row.name,
      profile: ship.profile,
      lifeSupport: ship.lifeSupport,
      crew: ship.crew
    }),
    [row.name, ship.profile, ship.lifeSupport, ship.crew]
  );
  return (
    // No title: the Meter below already carries the resource's name and its
    // accessible name, so a heading above it would say the same word twice.
    // The testid is the escape hatch a test needs to reach THIS row's own card
    // and assert its identity tab, there being no role or label of its own.
    /* @__PURE__ */ jsx4(
      Card,
      {
        identityColor,
        "data-testid": `resource-card-${row.name}`,
        children: /* @__PURE__ */ jsxs4(Stack3, { children: [
          /* @__PURE__ */ jsx4(
            Meter,
            {
              label: row.displayName,
              value: fill(row.fraction),
              tone: toneForRow(row, utNow),
              valueLabel: rowValueLabel(row, utNow, modelled),
              valueLabelNode: /* @__PURE__ */ jsx4(RowValueDisplay, { row, modelled })
            }
          ),
          row.role === "downstream" && row.blockedBy.length > 0 && /* @__PURE__ */ jsx4(Text3, { tone: "warn", size: "xs", children: /* @__PURE__ */ jsx4(
            LimitedByMessage,
            {
              subjectDisplayName: row.displayName,
              blockedBy: row.blockedBy,
              row
            }
          ) }),
          /* @__PURE__ */ jsx4(
            Disclosure,
            {
              variant: "inline",
              asButton: true,
              buttonSize: "sm",
              label: null,
              "aria-label": `Show rate breakdown for ${row.displayName}`,
              children: /* @__PURE__ */ jsx4(LedgerBody, { ledger })
            }
          )
        ] })
      }
    )
  );
}
function LimitedByMessage({
  subjectDisplayName,
  blockedBy,
  row
}) {
  const utNow = useContext(ViewUtContext);
  return /* @__PURE__ */ jsxs4(Fragment, { children: [
    subjectDisplayName,
    " is being limited by ",
    blockedBy.join(", "),
    ".",
    row !== void 0 && secondsToFloor(row, utNow) !== null && /* @__PURE__ */ jsxs4(Fragment, { children: [
      " ",
      subjectDisplayName,
      " ",
      /* @__PURE__ */ jsx4(CrossingTime, { row, approx: true })
    ] })
  ] });
}
function LedgerBody({ ledger }) {
  const ledgerReading = useContext(LedgerReadingContext);
  const hasResidual = ledger.residual !== void 0 && Math.abs(ledger.residual) > 1e-6;
  const maxAbsRate = value3(
    "units/s",
    Math.max(0, ...ledger.terms.map((t) => Math.abs(t.ratePerSecond)))
  );
  return (
    // No `minWidth`: a fixed floor forces this panel wider than the row that
    // hosts it, spilling the ledger past the widget's right edge at any width
    // narrower than the floor. `width: 100%` sizes it to whatever the accordion
    // panel actually has, at every panel width down to minSize.
    /* @__PURE__ */ jsxs4(Stack3, { style: { width: "100%", minWidth: 0 }, children: [
      ledger.terms.length === 0 ? /* @__PURE__ */ jsx4(Text3, { level: "muted", size: "xs", children: "No modelled sources" }) : ledger.terms.map((term) => (
        // `wrap`: the rate ("-0.01/s") is one unbreakable token (no space
        // for the browser's own text-wrap to catch), so once the term
        // NAME has shrunk as far as ITS wrapping allows, the rate has
        // nowhere left to shrink to. Flex-wrapping the row lets the
        // trailing group drop to a line of its own at the narrowest panel
        // widths instead of forcing the row, and everything above it, wider
        // than the panel: the overflow this function's own doc comment
        // describes.
        /* @__PURE__ */ jsxs4(
          Cluster4,
          {
            justify: "between",
            wrap: true,
            children: [
              /* @__PURE__ */ jsx4(Text3, { size: "xs", children: term.name }),
              /* @__PURE__ */ jsxs4(Cluster4, { justify: "start", children: [
                /* @__PURE__ */ jsx4(
                  DivergingBar,
                  {
                    value: ledgerReading ? combineReadings(
                      [ledgerReading],
                      () => value3("units/s", term.ratePerSecond)
                    ) : value3("units/s", term.ratePerSecond),
                    maxAbs: maxAbsRate
                  }
                ),
                /* @__PURE__ */ jsx4(Text3, { size: "xs", children: formatRate(term.ratePerSecond) })
              ] })
            ]
          },
          `${term.kind}-${term.name}-${term.flightId ?? ""}`
        )
      )),
      /* @__PURE__ */ jsx4(Divider, {}),
      /* @__PURE__ */ jsxs4(Cluster4, { justify: "between", wrap: true, children: [
        /* @__PURE__ */ jsx4(Text3, { level: "muted", size: "xs", children: "Net (derived)" }),
        /* @__PURE__ */ jsx4(Text3, { size: "xs", children: formatRate(ledger.derivedNet) })
      ] }),
      ledger.reportedNet !== void 0 && /* @__PURE__ */ jsxs4(Cluster4, { justify: "between", wrap: true, children: [
        /* @__PURE__ */ jsx4(Text3, { level: "muted", size: "xs", children: "Reported" }),
        /* @__PURE__ */ jsx4(Text3, { size: "xs", children: formatRate(ledger.reportedNet) })
      ] }),
      hasResidual && ledger.residual !== void 0 && // Same near-black-on-dark landmine as the row footnote above: the
      // `-fg-muted` override keeps this readable on the panel surface.
      // Every term above is already scaled by Kerbalism's own live modifier
      // product (envModifier/ruleEnvModifiers), so this residual is not
      // "modifiers we didn't model": it is a genuine model-vs-reality gap
      // (timewarp catch-up between samples, a consumer this ledger does not
      // enumerate) and is worth keeping visible as exactly that, never
      // hidden.
      /* @__PURE__ */ jsxs4(Text3, { tone: "warn", size: "xs", children: [
        "Residual ",
        formatRate(ledger.residual),
        " (unaccounted)"
      ] })
    ] })
  );
}
registerComponent({
  id: "ship-systems",
  name: "Ship Systems",
  description: "Vessel-wide Kerbalism resource ledger: root-cause diagnosis, every profile resource as a meter with a per-source rate ledger, wear gauges, habitat, processes, and the power meter.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 9, h: 15 },
  minSize: { w: 4, h: 5 },
  component: ShipSystemsComponent,
  dataRequirements: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    "vessel.resources",
    "vessel.crew"
  ],
  channels: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    "vessel.resources",
    "vessel.crew"
  ],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  // The slot the Greenhouse augment fills, now named for the widget that
  // actually hosts it. It carried the deleted LifeSupportSystems widget's
  // `life-support.` prefix until the rename, which matched no registered
  // component id, so `${componentId}.${segment}` could never derive it.
  augmentSlots: ["ship-systems.life-support"],
  owner: KERBALISM
});

// src/ShipSystems/badge.ts
import { heldGradeOf } from "@ksp-gonogo/ui-kit";
function statusBadges(ship, held) {
  if (!ship) return null;
  const grade = heldGradeOf(held);
  const marked = grade === void 0 ? {} : { held: grade };
  const { causes, supplies } = ship.summary;
  const rootCause = causes[0];
  if (rootCause !== void 0) {
    return [
      {
        id: "ship-systems-status",
        label: `${rootCause.displayName} critical`,
        tone: "nogo",
        ...marked
      }
    ];
  }
  const low = supplies.find((row) => row.belowLowThreshold === true);
  if (low !== void 0) {
    return [
      {
        id: "ship-systems-status",
        label: `${low.displayName} low`,
        tone: "warn",
        ...marked
      }
    ];
  }
  return null;
}
KERBALISM.registerContribution({
  id: "ship-systems-badge",
  contributes: "ship-systems.badges",
  deps: [SHIP_SYSTEMS],
  requires: "kerbalism",
  /*
   * The processor answers with currency, so its answer is unwrapped here. Both
   * value-bearing arms: a badge drawn from a held summary is still the last
   * real verdict, and the panel says separately that its figures are dated.
   */
  compute: (topics) => {
    const reading = topics[SHIP_SYSTEMS.id];
    return statusBadges(
      reading?.state === "observed" || reading?.state === "held" ? reading.value : void 0,
      reading
    );
  }
});

// src/CrewSurvival/index.tsx
import { registerAugment as registerAugment3, useProcessor as useProcessor2, value as value8 } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge4,
  ModelledAlongside as ModelledAlongside2,
  modelledBeyondReceived as modelledBeyondReceived2,
  writeQuantity as writeQuantity2
} from "@ksp-gonogo/ui-kit";

// src/CrewSurvival/meters.ts
import { value as value7 } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf9, writeQuantity } from "@ksp-gonogo/ui-kit";

// src/CrewSurvival/processor.ts
import { deriveReading as deriveReading2, value as value4 } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf6, magnitudeOr as magnitudeOr4 } from "@ksp-gonogo/ui-kit";
var SOON_DEATH_SEC = 600;
var CRITICAL_FRACTION = 0.8;
function toneFor(fraction) {
  if (fraction >= CRITICAL_FRACTION) return "nogo";
  if (fraction >= 0.5) return "warn";
  return "go";
}
function kerbalTone(worstFraction, marginToActSec) {
  if (marginToActSec !== null && marginToActSec < SOON_DEATH_SEC) return "nogo";
  return toneFor(worstFraction);
}
function onFatalAxis(accumulated, threshold) {
  return accumulated.dividedBy(threshold).in("ratio").max(0).min(1);
}
function ruleFraction(rule) {
  const accumulated = rule.problem;
  const threshold = rule.fatalThreshold;
  if (accumulated == null || threshold == null) return null;
  if (magnitudeOf6(accumulated) === null) return null;
  const limit = magnitudeOr4(threshold, Number.NaN);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return magnitudeOf6(onFatalAxis(accumulated, threshold));
}
function toKerbalSurvival(name, trait, entry, marginToAct2, carried) {
  const rules = [];
  for (const rule of entry?.rules ?? []) {
    if (!rule.name) continue;
    const fraction = ruleFraction(rule);
    if (fraction === null) continue;
    rules.push(
      carried.has(ruleKey(name, rule.name)) ? { name: rule.name, fraction, carried: true } : { name: rule.name, fraction }
    );
  }
  rules.sort((a, b) => b.fraction - a.fraction);
  const worstRule = rules[0];
  return {
    name,
    trait,
    rules,
    worstRule,
    marginToAct: marginToAct2,
    tone: kerbalTone(worstRule?.fraction ?? 0, magnitudeOf6(marginToAct2.value))
  };
}
function marginSecondsOf(kerbal) {
  return magnitudeOf6(kerbal.marginToAct.value);
}
function marginToAct(kerbals, name, receivedUt, oneWay) {
  const deadlineIn = (entries) => {
    const deadline = entries.find((e) => e.name === name)?.deathClockUt;
    return deadline?.isFinite() === true ? deadline : void 0;
  };
  const marginFrom = (deadline, fromUt) => {
    if (deadline === void 0 || oneWay === null) return void 0;
    return deadline.minus(fromUt).minus(oneWay).max(0);
  };
  return deriveReading2(
    kerbals,
    (entries) => marginFrom(deadlineIn(entries), receivedUt),
    (modelled, atUt) => marginFrom(deadlineIn(modelled), atUt)
  );
}
function oneWayOf(delay) {
  const oneWay = delay?.oneWaySeconds;
  return oneWay?.isFinite() === true ? oneWay : null;
}
function deriveCrewSurvival(crew, kerbals, marginOf, carried = /* @__PURE__ */ new Set()) {
  const byName = /* @__PURE__ */ new Map();
  for (const entry of kerbals ?? []) {
    if (entry.name) byName.set(entry.name, entry);
  }
  const kerbalsOut = (crew?.crew ?? []).map((member) => {
    const name = member.name ?? "Unknown";
    return toKerbalSurvival(
      name,
      member.trait,
      byName.get(name),
      marginOf(name),
      carried
    );
  });
  const clocks = kerbalsOut.map(marginSecondsOf).filter((s) => s !== null);
  return {
    kerbals: kerbalsOut,
    soonestMarginToActSec: clocks.length > 0 ? Math.min(...clocks) : null
  };
}
var CREW_SURVIVAL = KERBALISM.registerProcessor({
  id: "crew-survival",
  deps: ["vessel.crew", { reading: "kerbalism.crew" }, "comms.delay"],
  // Explicitly typed (rather than relying on inference through the sdk
  // facade's intentionally loose `compute: (values: any) => R` leaf
  // signature, see registerProcessor's own doc comment): an `any`-typed
  // receiver does not contextually type a chained `.map()`/`.filter()`
  // callback's own parameters, which trips `noImplicitAny` on every one of
  // them the moment more than plain property access is needed.
  compute: ([crew, kerbals, delay], frame) => {
    const receivedUt = value4("ut", frame.viewUt);
    const oneWay = oneWayOf(delay);
    const marginOf = (name) => marginToAct(kerbals, name, receivedUt, oneWay);
    if (kerbals.state === "held" && kerbals.reckoning.status === "available") {
      const projected = kerbals.reckoning.value;
      return {
        ...deriveCrewSurvival(
          crew,
          projected,
          marginOf,
          carriedRules(projected, kerbals.reckoning.modelled)
        ),
        basis: kerbals.reckoning.basis
      };
    }
    return deriveCrewSurvival(
      crew,
      kerbals.state === "observed" || kerbals.state === "held" ? kerbals.value : void 0,
      marginOf
    );
  }
});
function survivalFrom(reading) {
  if (reading?.state !== "observed" && reading?.state !== "held") {
    return void 0;
  }
  const survival = reading.value;
  if (survival === void 0) return void 0;
  return {
    survival,
    held: reading.state === "held",
    basis: reading.state === "held" ? survival.basis : void 0
  };
}
function ruleKey(kerbal, rule) {
  return `${kerbal}\0${rule}`;
}
function carriedRules(projected, modelled) {
  const carried = /* @__PURE__ */ new Set();
  for (const { path } of modelled) {
    const match = /^(\d+)\.rules\.(\d+)\.problem$/.exec(path);
    if (!match) continue;
    const entry = projected[Number(match[1])];
    const rule = entry?.rules?.[Number(match[2])];
    if (entry?.name && rule?.name) carried.add(ruleKey(entry.name, rule.name));
  }
  return carried;
}
function criticalCause(kerbal) {
  if (kerbal.tone !== "nogo") return null;
  const margin = marginSecondsOf(kerbal);
  if (margin !== null && margin < SOON_DEATH_SEC) return "death-clock";
  return kerbal.worstRule?.carried ? "carried-rule" : "rule";
}

// src/CrewSurvival/ruleReadings.ts
import { bandIn, value as value6 } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf8 } from "@ksp-gonogo/ui-kit";

// src/crewReckoning.ts
import { value as value5 } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf7 } from "@ksp-gonogo/ui-kit";
var CREW_DEGENERATION_HORIZON_SECONDS = 600;
var CREW_HISTORY = {
  spanUt: 1800,
  maxSamples: 32,
  minSamples: 2
};
function fitSlope(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
  }
  if (varianceX === 0) return null;
  const perSecond = covariance / varianceX;
  if (!Number.isFinite(perSecond)) return null;
  if (n < 3) return { perSecond, sigma: void 0, samples: n };
  const intercept = meanY - perSecond * meanX;
  let residualSquares = 0;
  for (const [x, y] of pairs) {
    residualSquares += (y - (intercept + perSecond * x)) ** 2;
  }
  const sigma = Math.sqrt(residualSquares / (n - 2) / varianceX);
  return {
    perSecond,
    sigma: Number.isFinite(sigma) ? sigma : void 0,
    samples: n
  };
}
var clamp = (x, low, high) => x < low ? low : x > high ? high : x;
function pairsFor(history, subject, kerbalName, ruleName) {
  const pairs = [];
  for (const point of history) {
    if (point.meta.source !== subject) continue;
    const entry = point.payload?.find((e) => e.name === kerbalName);
    const asOfUt = magnitudeOf7(entry?.rulesAsOfKerbalismUt);
    const rule = entry?.rules?.find((r) => r.name === ruleName);
    const at = magnitudeOf7(rule?.problem);
    if (asOfUt === null || at === null) continue;
    pairs.push([asOfUt, at]);
  }
  return pairs;
}
function movingAccumulators(observed, history, subject, reckonUt) {
  const moving = [];
  observed.forEach((entry, kerbal) => {
    const asOfUt = magnitudeOf7(entry.rulesAsOfKerbalismUt);
    if (asOfUt === null) return;
    const elapsed = reckonUt - asOfUt;
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > CREW_DEGENERATION_HORIZON_SECONDS) {
      return;
    }
    entry.rules?.forEach((rule, index) => {
      const from = magnitudeOf7(rule.problem);
      if (from === null || entry.name == null || rule.name == null) return;
      const fit = fitSlope(pairsFor(history, subject, entry.name, rule.name));
      if (fit === null || fit.perSecond === 0) return;
      moving.push({
        kerbal,
        rule: index,
        path: `${kerbal}.rules.${index}.problem`,
        from,
        slope: fit.perSecond,
        slopeSigma: fit.sigma,
        asOfUt,
        // The threshold is where this model stops describing anybody. Absent,
        // there is no ceiling to clamp at and the horizon is the only limit.
        ceiling: magnitudeOf7(rule.fatalThreshold) ?? Number.POSITIVE_INFINITY
      });
    });
  });
  return moving;
}
function reckonCrewAccumulators(point, { reckonUt, history }) {
  const observed = point.payload;
  if (observed == null) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no crew roster was observed, so there is nothing to advance"
      }
    };
  }
  const moving = movingAccumulators(
    observed,
    history,
    point.meta.source,
    reckonUt
  );
  if (moving.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "no accumulator aboard was observed to be moving, so every rule here is supplied and its value is the reading itself"
      }
    };
  }
  const modelled = [
    { path: "", basis: "rate-integration" },
    ...moving.map(({ path }) => ({
      path,
      basis: "rate-integration"
    }))
  ];
  return {
    modelled,
    reckon: (at) => {
      const next = observed.map((entry) => ({
        ...entry,
        rules: entry.rules?.map((rule) => ({ ...rule }))
      }));
      for (const carried of moving) {
        const target = next[carried.kerbal].rules?.[carried.rule];
        if (!target) continue;
        target.problem = value5("units", carriedValue(carried, at));
      }
      return next;
    },
    bandAt: (at) => {
      const bands = {};
      for (const carried of moving) {
        const { slopeSigma, asOfUt, ceiling } = carried;
        if (slopeSigma === void 0) continue;
        const centre = carriedValue(carried, at);
        const halfWidth = Math.abs(at - asOfUt) * slopeSigma;
        if (!Number.isFinite(halfWidth)) continue;
        bands[carried.path] = {
          value: value5("units", centre),
          /*
           * Clamped to the same range the value is, because the range is not a
           * display convenience: below zero the accumulator does not exist,
           * and above the fatal threshold the kerbal is dead and no rate here
           * describes anybody. An end outside it would be an interval over
           * states that cannot occur, which is a worse claim than a narrow one.
           */
          lo: value5("units", clamp(centre - halfWidth, 0, ceiling)),
          hi: value5("units", clamp(centre + halfWidth, 0, ceiling)),
          kind: "sigma1"
        };
      }
      return Object.keys(bands).length > 0 ? bands : void 0;
    }
  };
}
function carriedValue({ from, slope, asOfUt, ceiling }, at) {
  return clamp(from + slope * (at - asOfUt), 0, ceiling);
}
KERBALISM.registerReckoner(KERBALISM_CREW_TOPIC, {
  deps: [],
  window: CREW_HISTORY,
  reckon: (point, _resolved, frame) => reckonCrewAccumulators(point, frame)
});

// src/CrewSurvival/ruleReadings.ts
function ruleKey2(kerbalName, ruleName) {
  return `${kerbalName}:${ruleName}`;
}
function ruleReadings(reading) {
  const readings = {};
  const observed = reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
  if (!observed) return readings;
  observed.forEach((entry, kerbal) => {
    entry.rules?.forEach((rule, index) => {
      const fraction = ruleFraction(rule);
      const threshold = rule.fatalThreshold;
      if (fraction === null || threshold == null) return;
      if (entry.name == null || rule.name == null) return;
      const key = ruleKey2(entry.name, rule.name);
      if (Object.hasOwn(readings, key)) return;
      readings[key] = fractionReading(
        reading,
        value6("ratio", fraction),
        kerbal,
        index,
        threshold
      );
    });
  });
  return readings;
}
function fractionReading(reading, observedFraction, kerbal, index, threshold) {
  const reckoning = fractionReckoning(reading, kerbal, index, threshold);
  if (reading.state === "observed") {
    return {
      state: "observed",
      value: observedFraction,
      atUt: reading.atUt,
      reckoning
    };
  }
  if (reading.state === "held") {
    return {
      state: "held",
      value: observedFraction,
      asOfUt: reading.asOfUt,
      grade: reading.grade,
      reckoning
    };
  }
  return { state: reading.state, reckoning: { status: "none" } };
}
function fractionReckoning(reading, kerbal, index, threshold) {
  const problem = reading[kerbal]?.rules[index]?.problem.reckoning;
  if (problem?.status !== "available") return { status: "none" };
  const carried = problem.modelled;
  const band = bandIn(problem.band, "units");
  return {
    status: "available",
    atUt: problem.atUt,
    beyondReceived: problem.beyondReceived,
    modelled: carried == null || magnitudeOf8(carried) === null ? value6("ratio", 0) : onFatalAxis(carried, threshold),
    basis: problem.basis,
    band: band === void 0 ? void 0 : onAxis(band, threshold)
  };
}
function onAxis(band, threshold) {
  return {
    value: onFatalAxis(band.value, threshold),
    lo: onFatalAxis(band.lo, threshold),
    hi: onFatalAxis(band.hi, threshold),
    kind: band.kind
  };
}
var CREW_RULE_READINGS = KERBALISM.registerProcessor({
  id: "crew-rule-readings",
  // A READING, not the payload, and the only dep: the reckoning is the whole
  // subject here, and a contribution cannot ask for one itself.
  deps: [{ reading: KERBALISM_CREW_TOPIC }],
  compute: ([reading]) => ruleReadings(reading)
});

// src/CrewSurvival/meters.ts
var RADIATION_DOSE_RULE_NAMES = /* @__PURE__ */ new Set(["radiation", "dose"]);
function ruleLabel(name) {
  if (RADIATION_DOSE_RULE_NAMES.has(name.toLowerCase())) {
    return "Radiation dose";
  }
  return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
var pct = (v) => writeQuantity(value7("%", v * 100), { decimals: 0 });
function survivalMeters(survival, readings) {
  if (!survival) return null;
  const entries = [];
  for (const kerbal of survival.kerbals) {
    for (const rule of kerbal.rules) {
      const id = ruleKey2(kerbal.name, rule.name);
      const reading = readings?.[id];
      const observed = magnitudeOf9(reading?.value) ?? rule.fraction;
      entries.push({
        id,
        label: ruleLabel(rule.name),
        /*
         * The whole READING, so the bar says how current the figure is and the
         * kit draws the crew model's interval as marks on the track it is
         * about. The lookup is the primitive's and the treatment is the
         * primitive's; this only has to not throw the reading away.
         *
         * The bare fraction is the fallback rather than the norm: it is what
         * is left when the wire carried a rule the reading cannot be keyed to,
         * and a meter drawn from it is the picture every one of these was
         * before the model existed.
         */
        value: reading ?? value7("ratio", rule.fraction),
        tone: toneFor(observed),
        // A caller's label replaces the kit's `<Unit>`, and with it the mark
        // saying the figure is held, so a reading goes without one.
        ...reading === void 0 ? { valueLabel: pct(rule.fraction) } : {},
        // The roster row this meter belongs beside: CrewStatus draws each
        // kerbal's meters under that kerbal, filtered on this name.
        row: kerbal.name
      });
    }
  }
  return entries.length > 0 ? entries : null;
}
KERBALISM.registerContribution({
  id: "crew-survival-meters",
  contributes: "crew-status.meters",
  deps: [CREW_SURVIVAL, CREW_RULE_READINGS],
  requires: "kerbalism",
  /*
   * Both answer with currency and are unwrapped here. A meter's own currency is
   * its rule's reading, which `Meter` marks itself; `CREW_SURVIVAL` supplies
   * only which kerbals there are and the order they sit in.
   */
  compute: (topics) => {
    const rules = topics[CREW_RULE_READINGS.id];
    return survivalMeters(
      survivalFrom(topics[CREW_SURVIVAL.id])?.survival,
      rules?.state === "observed" || rules?.state === "held" ? rules.value : void 0
    );
  }
});

// src/CrewSurvival/index.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function findKerbal(survival, crewName, crewIndex) {
  const byIndex = survival.kerbals[crewIndex];
  return byIndex?.name === crewName ? byIndex : survival.kerbals.find((k) => k.name === crewName);
}
function warningFor(kerbal) {
  if (kerbal.tone !== "nogo") return null;
  const margin = marginSecondsOf(kerbal);
  if (margin !== null) {
    if (margin <= 0) {
      return { label: "too late", severity: "nogo" };
    }
    return {
      label: `~${writeQuantity2(value8("s", margin))} to act`,
      severity: "nogo",
      observed: value8("s", margin),
      modelled: modelledBeyondReceived2(kerbal.marginToAct)
    };
  }
  if (kerbal.worstRule) {
    return {
      label: `${ruleLabel(kerbal.worstRule.name)} critical`,
      severity: "nogo"
    };
  }
  return null;
}
function CrewSurvivalBadgeAugment({
  crewName,
  crewIndex
}) {
  const answer = survivalFrom(useProcessor2(CREW_SURVIVAL));
  if (!answer) return null;
  const kerbal = findKerbal(answer.survival, crewName, crewIndex);
  if (!kerbal) return null;
  const warning = warningFor(kerbal);
  if (!warning) return null;
  const modelled = answer.held && marginSecondsOf(kerbal) === null && criticalCause(kerbal) === "carried-rule" ? answer.basis : void 0;
  const label = !answer.held ? warning.label : modelled ? `${warning.label} \xB7 modelled` : `${warning.label} \xB7 held`;
  return /* @__PURE__ */ jsxs5(Badge4, { tone: warning.severity, size: "sm", "data-reckoning-basis": modelled, children: [
    label,
    /* @__PURE__ */ jsx5(
      ModelledAlongside2,
      {
        observed: warning.observed,
        modelled: warning.modelled,
        write: writeMargin
      }
    )
  ] });
}
function writeMargin(margin) {
  return `~${writeQuantity2(margin)}`;
}
registerAugment3({
  id: "crew-status-survival-badge",
  augments: "crew-status.row-badges",
  component: CrewSurvivalBadgeAugment,
  requires: "kerbalism",
  owner: KERBALISM
});

// src/CrewSurvival/badge.ts
function survivalBadges(survival, currency = "current") {
  if (!survival) return null;
  const critical = survival.kerbals.filter((k) => k.tone === "nogo").length;
  if (critical === 0) return null;
  if (currency === "current") {
    return [
      {
        id: "crew-survival-status",
        label: critical === 1 ? "Crew critical" : `${critical} crew critical`,
        tone: "nogo"
      }
    ];
  }
  const label = currency === "modelled" ? critical === 1 ? "Crit \xB7 modelled" : `${critical} crit \xB7 modelled` : critical === 1 ? "Critical \xB7 held" : `${critical} critical \xB7 held`;
  return [{ id: "crew-survival-status", label, tone: "nogo" }];
}
function survivalBadgesFor(answer) {
  if (!answer) return null;
  const rests = answer.survival.kerbals.some(
    (k) => criticalCause(k) === "carried-rule"
  );
  return survivalBadges(
    answer.survival,
    !answer.held ? "current" : rests ? "modelled" : "held"
  );
}
KERBALISM.registerContribution({
  id: "crew-survival-badge",
  contributes: "crew-status.badges",
  deps: [CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) => survivalBadgesFor(survivalFrom(topics[CREW_SURVIVAL.id]))
});
function bandBadges(readings, survival, held) {
  if (!readings) return null;
  const criticalNow = new Set(
    (survival?.kerbals ?? []).filter((k) => k.tone === "nogo").map((k) => k.name)
  );
  const atRisk = /* @__PURE__ */ new Set();
  for (const [key, reading] of Object.entries(readings)) {
    const kerbal = key.slice(0, key.lastIndexOf(":"));
    if (criticalNow.has(kerbal)) continue;
    if (reading.reckoning.status !== "available") continue;
    const band = reading.reckoning.band;
    if (band === void 0) continue;
    if (!band.hi.greaterThanOrEqual(CRITICAL_FRACTION)) continue;
    const figure = reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
    if (figure?.greaterThanOrEqual(CRITICAL_FRACTION)) continue;
    atRisk.add(kerbal);
  }
  if (atRisk.size === 0) return null;
  const label = atRisk.size === 1 ? "Crew critical in model range" : `${atRisk.size} crew critical in model range`;
  return [
    {
      id: "crew-survival-band",
      label,
      tone: "warn",
      ...held === void 0 ? {} : { held }
    }
  ];
}
KERBALISM.registerContribution({
  id: "crew-survival-band-badge",
  contributes: "crew-status.badges",
  deps: [CREW_RULE_READINGS, CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) => {
    const rules = topics[CREW_RULE_READINGS.id];
    return bandBadges(
      rules?.state === "observed" || rules?.state === "held" ? rules.value : void 0,
      survivalFrom(topics[CREW_SURVIVAL.id])?.survival,
      rules
    );
  }
});

// src/CrewSurvival/rowTone.ts
function rowTones(survival, held) {
  if (!survival) return null;
  const entries = survival.kerbals.filter((k) => k.tone === "nogo").map((k) => ({
    crewName: k.name,
    tone: "nogo",
    ...held === void 0 ? {} : { held }
  }));
  return entries.length > 0 ? entries : null;
}
KERBALISM.registerContribution({
  id: "crew-survival-row-tone",
  contributes: "crew-status.row-tone",
  deps: [CREW_SURVIVAL],
  requires: "kerbalism",
  compute: (topics) => rowTones(
    survivalFrom(topics[CREW_SURVIVAL.id])?.survival,
    topics[CREW_SURVIVAL.id]
  )
});

// src/SpaceWeather/index.tsx
import {
  CELESTIAL_FACTS,
  registerComponent as registerComponent2,
  useProcessor as useProcessor3,
  useStream,
  useTelemetry as useTelemetry3,
  useViewUt,
  value as value9
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge5,
  Box,
  Card as Card2,
  Cluster as Cluster5,
  Countdown,
  EmptyState as EmptyState2,
  Meter as Meter2,
  MissionDate,
  magnitudeOf as magnitudeOf10,
  NULL_DISPLAY as NULL_DISPLAY3,
  Panel as Panel2,
  ReadoutCaption as ReadoutCaption2,
  Section as Section3,
  SectionTitle,
  Stack as Stack4,
  Text as Text4,
  Unit as Unit4
} from "@ksp-gonogo/ui-kit";
import { css, keyframes, styled } from "styled-components";
import { Fragment as Fragment2, jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
var ABSENCE_TEXT = {
  /* Two different sentences on purpose: a vessel whose subject confirms it has
     no space-weather record (no Kerbalism, or nothing loaded) is not waiting for
     anything. A held record does not empty the board, so it has no sentence
     here. */
  "confirmed-none": "No space-weather data reported",
  awaiting: "Awaiting space weather"
};
function useSpaceWeather() {
  const weatherReading = useTelemetry3("kerbalism.spaceweather");
  const flightReading = useTelemetry3("vessel.flight");
  const flightValue = flightReading.state === "observed" || flightReading.state === "held" ? flightReading.value : void 0;
  const flight = flightValue && flightReading.reckoning.status === "available" ? { ...flightValue, ...flightReading.reckoning.value } : flightReading.state === "observed" ? flightReading.value : void 0;
  const t = weatherReading.state === "observed" || weatherReading.state === "held" ? weatherReading.value : void 0;
  const held = weatherReading.state === "held";
  if (t === void 0) {
    return {
      readable: false,
      absence: weatherReading.state === "absent" ? "confirmed-none" : "awaiting"
    };
  }
  const stormState = t.stormInProgress ? "inprogress" : t.stormIncoming ? "incoming" : t.stormInProgress == null || t.stormIncoming == null ? "unknown" : "none";
  const radiationRadPerSecond = magnitudeOf10(t.radiationRadPerSecond);
  const radiationRadPerHour = radiationRadPerSecond === null ? null : value9("rad/s", radiationRadPerSecond).in("rad/h").magnitude;
  const innerBelt = held ? false : t.innerBelt ?? false;
  const outerBelt = held ? false : t.outerBelt ?? false;
  const magnetosphere = held ? false : t.magnetosphere ?? false;
  const altitudeM = magnitudeOf10(flight?.altitudeAsl);
  return {
    readable: true,
    held,
    data: {
      radiationRadPerHour,
      /* `none` is a promise and a dated one is worth nothing, so a held record
         reports the state it actually has: unknown. The header verdict reads
         this and already answers unknown for it. */
      stormState: held ? "unknown" : stormState,
      innerBelt,
      outerBelt,
      magnetosphere,
      blackout: t.blackout ?? false,
      shieldingValue: magnitudeOf10(t.shieldingAmount),
      // (stormTimeSec removed: see the FUTURE note above.)
      shieldingCapacity: magnitudeOf10(t.shieldingCapacity),
      // The "you are here" dot: a dated altitude would place the craft in a band
      // it may have left, so the rings draw no dot rather than a held one.
      altitudeKm: held || altitudeM === null ? null : altitudeM / 1e3,
      stars: t.stars ?? [],
      storms: t.storms ?? [],
      stormEjectionSpeedMps: magnitudeOf10(t.stormEjectionSpeed),
      // Deterministic noise seed derived from the weather state itself (stable
      // across renders for snapshots; no Math.random, no clock/provider needed).
      // A seed, not a reading, so an unreported dose contributes nothing here
      // rather than propagating an absence into the chart's PRNG.
      seed: Math.round((radiationRadPerHour ?? 0) * 1e3) + (magnetosphere ? 7 : 0) + (innerBelt ? 13 : 0) + (outerBelt ? 29 : 0) + (stormState === "inprogress" ? 101 : stormState === "incoming" ? 53 : 0)
    }
  };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function doseFraction(radPerHour) {
  const lo = 5e-3;
  const hi = 12;
  const r = Math.max(lo, Math.min(hi, radPerHour));
  return Math.log(r / lo) / Math.log(hi / lo);
}
function doseTone(radPerHour) {
  if (radPerHour === null) return "info";
  if (radPerHour >= 3) return "nogo";
  if (radPerHour >= 0.5) return "warn";
  if (radPerHour >= 0.05) return "info";
  return "go";
}
var TONE_HEX = {
  go: "var(--color-go-mark)",
  info: "var(--color-info-mark)",
  warn: "var(--color-warn-mark)",
  nogo: "var(--color-nogo-mark)"
};
function statusFor(d, held) {
  if (held) return { label: "Held", tone: "info" };
  if (d.stormState === "inprogress" || d.radiationRadPerHour !== null && d.radiationRadPerHour >= 3)
    return { label: "Storm in progress", tone: "nogo" };
  if (d.stormState === "incoming" || d.innerBelt || d.outerBelt)
    return { label: "Exposed", tone: "warn" };
  if (!d.magnetosphere) return { label: "Unshielded", tone: "info" };
  if (d.radiationRadPerHour === null || d.stormState === "unknown")
    return { label: "Storm watch unread", tone: "info" };
  return { label: "Sheltered", tone: "go" };
}
function deriveStorm(entry, index, nowUt, stormEjectionSpeedMps) {
  const state = magnitudeOf10(entry.stormState);
  const stormTime = magnitudeOf10(entry.stormTime);
  const dist = magnitudeOf10(entry.dist);
  const impactEtaSec = stormTime !== null && nowUt !== null ? stormTime - nowUt : null;
  let departureUt = null;
  let progressPct = null;
  if (stormTime !== null && dist !== null && stormEjectionSpeedMps !== null && stormEjectionSpeedMps > 0) {
    const transitSec = dist / stormEjectionSpeedMps;
    departureUt = stormTime - transitSec;
    if (nowUt !== null) {
      progressPct = transitSec > 0 ? Math.max(
        0,
        Math.min(100, (nowUt - departureUt) / transitSec * 100)
      ) : 100;
    }
  }
  return {
    key: `${entry.star ?? "star"}-${index}`,
    star: entry.star ?? "Unknown star",
    state,
    departureUt,
    progressPct,
    impactEtaSec,
    targetKind: entry.targetKind ?? null,
    targetName: entry.targetName ?? null
  };
}
function stormSeverity(state) {
  if (state === null) return "info";
  return state >= 2 ? "nogo" : "warn";
}
function stormLabel(state) {
  if (state === null) return "Unread";
  return state >= 2 ? "Impact" : "Inbound";
}
var SEVERITY_CARD_TONE = {
  go: "go",
  info: "neutral",
  caution: "caution",
  warn: "warn",
  nogo: "nogo",
  offline: "offline"
};
var SEVERITY_HEX = {
  go: "var(--color-go-mark)",
  info: "var(--color-info-mark)",
  caution: "var(--color-caution-mark)",
  warn: "var(--color-warn-mark)",
  nogo: "var(--color-nogo-mark)",
  offline: "var(--color-text-muted)"
};
var STAR_FILL = "var(--color-tag-yellow-fg)";
var STORM_TARGET_VESSEL = 1;
function seedForStar(name) {
  let s = name.length * 101 + 1;
  for (let i = 0; i < name.length; i++) s = s * 31 + name.charCodeAt(i) | 0;
  return s || 1;
}
function pointAt(r, deg) {
  const rad = deg * Math.PI / 180;
  return { x: 50 + r * Math.sin(rad), y: 50 - r * Math.cos(rad) };
}
function starActivity(allStorms, starName) {
  const mine = allStorms.filter((s) => s.star === starName && s.state !== 0);
  if (mine.length === 0) return { level: 0, severity: "go", storms: [] };
  const read3 = mine.filter((s) => s.state !== null);
  if (read3.length === 0) return { level: 0, severity: "info", storms: mine };
  const severity = read3.some((s) => (s.state ?? 0) >= 2) ? "nogo" : "warn";
  const level = Math.max(
    ...read3.map((s) => {
      if ((s.state ?? 0) >= 2) return 1;
      if (s.departureUt === null || s.progressPct === null) return 0.5;
      return Math.max(0.15, Math.min(1, s.progressPct / 100));
    })
  );
  return { level, severity, storms: mine };
}
function ringGeometry(level) {
  return {
    baseR: 20 + level * 18,
    jitterAmp: 1.2 + level * 7,
    strokeWidth: 1 + level * 1.6,
    opacity: 0.4 + level * 0.5
  };
}
function ringPathD(seed, level) {
  const rng = mulberry32(seed);
  const { baseR, jitterAmp } = ringGeometry(level);
  const ringPoints = 28;
  let d = "";
  for (let i = 0; i <= ringPoints; i++) {
    const deg = 360 * i / ringPoints;
    const jitter = (rng() - 0.5) * jitterAmp;
    const { x, y } = pointAt(baseR + jitter, deg);
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}
function ringColor(level, severity) {
  return level <= 0 ? "var(--color-text-muted)" : SEVERITY_HEX[severity];
}
var cmeRingPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;
var RingPath = styled.path`
  ${({ $active }) => $active && css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${cmeRingPulse} 2.4s ease-in-out infinite;
      }
    `}
`;
function StarDiagram({
  starName,
  activity,
  compact
}) {
  const seed = seedForStar(starName);
  const d = ringPathD(seed, activity.level);
  const { strokeWidth, opacity } = ringGeometry(activity.level);
  const color = ringColor(activity.level, activity.severity);
  const label = activity.level <= 0 ? `Solar activity for ${starName}: baseline` : `Solar activity for ${starName}: ${activity.severity === "nogo" ? "CME impacting" : "CME inbound"}`;
  return /* @__PURE__ */ jsx6(
    Box,
    {
      style: {
        flex: "0 0 auto",
        height: compact ? 56 : 76,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      },
      children: /* @__PURE__ */ jsxs6(
        "svg",
        {
          viewBox: "0 0 100 100",
          width: "100%",
          height: "100%",
          role: "img",
          "aria-label": label,
          children: [
            /* @__PURE__ */ jsx6(
              RingPath,
              {
                d,
                fill: "none",
                stroke: color,
                strokeWidth,
                opacity,
                $active: activity.level > 0
              }
            ),
            activity.storms.map((storm, i) => {
              const count = activity.storms.length;
              const centreDeg = 360 * i / count;
              const tip = pointAt(46, centreDeg);
              const left = pointAt(24, centreDeg - 3);
              const right = pointAt(24, centreDeg + 3);
              return /* @__PURE__ */ jsx6(
                "polygon",
                {
                  points: `${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`,
                  fill: SEVERITY_HEX[stormSeverity(storm.state)]
                },
                storm.key
              );
            }),
            /* @__PURE__ */ jsx6("circle", { cx: 50, cy: 50, r: 14, fill: STAR_FILL })
          ]
        }
      )
    }
  );
}
function transitThreatColor(storm) {
  if (storm.state !== null && storm.state >= 2) return "var(--color-nogo-mark)";
  if (storm.progressPct === null) return "var(--color-info-mark)";
  if (storm.progressPct >= 66) return "var(--color-nogo-mark)";
  if (storm.progressPct >= 33) return "var(--color-warn-mark)";
  return "var(--color-info-mark)";
}
function StormCard({
  storm,
  compact,
  fallbackBodyName
}) {
  const severity = stormSeverity(storm.state);
  const target = storm.targetName ?? fallbackBodyName ?? "current body";
  const verb = storm.state === null ? "CME state unread for" : storm.state >= 2 ? "Impacting" : "Inbound to";
  const qualifier = storm.targetKind === STORM_TARGET_VESSEL ? " (current vessel)" : "";
  return /* @__PURE__ */ jsx6(
    Card2,
    {
      tone: SEVERITY_CARD_TONE[severity],
      title: storm.star,
      titleRight: /* @__PURE__ */ jsx6(Badge5, { tone: severity, size: "sm", children: stormLabel(storm.state) }),
      children: /* @__PURE__ */ jsxs6(Stack4, { children: [
        /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: `${verb} ${target}${qualifier}` }),
        storm.departureUt !== null ? /* @__PURE__ */ jsxs6(Fragment2, { children: [
          !compact && /* @__PURE__ */ jsxs6(Cluster5, { justify: "between", children: [
            /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: "Departed" }),
            /* @__PURE__ */ jsx6(Text4, { size: "xs", children: /* @__PURE__ */ jsx6(MissionDate, { value: storm.departureUt }) })
          ] }),
          storm.progressPct !== null ? /* @__PURE__ */ jsx6(
            Meter2,
            {
              hideLabel: true,
              label: `Transit progress from ${storm.star}`,
              value: value9("ratio", storm.progressPct / 100),
              fillColor: transitThreatColor(storm)
            }
          ) : /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: "Transit progress needs a mission clock." })
        ] }) : /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: "Transit data not yet captured." }),
        /* @__PURE__ */ jsxs6(Cluster5, { justify: "between", children: [
          /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: "Impact" }),
          /* @__PURE__ */ jsx6(
            Text4,
            {
              tone: storm.state !== null && storm.state >= 2 ? "nogo" : "warn",
              size: "xs",
              weight: "semibold",
              children: storm.impactEtaSec !== null ? /* @__PURE__ */ jsx6(Countdown, { value: storm.impactEtaSec, clock: true }) : "unknown"
            }
          )
        ] })
      ] })
    }
  );
}
function StormTimeline({ state }) {
  const phases = [
    { key: "quiet", label: "Quiet", tone: "go", w: 34 },
    { key: "incoming", label: "Incoming", tone: "warn", w: 22 },
    { key: "inprogress", label: "Storm", tone: "nogo", w: 22 },
    { key: "passed", label: "Passed", tone: "go", w: 22 }
  ];
  const nowPct = state === "unknown" ? null : state === "none" ? 17 : state === "incoming" ? 45 : 67;
  const headline = state === "inprogress" ? "Storm in progress" : state === "incoming" ? "CME inbound" : state === "unknown" ? "Storm state unread" : "No storm activity";
  let acc = 0;
  return /* @__PURE__ */ jsxs6(Section3, { style: STAT_SECTION, children: [
    /* @__PURE__ */ jsxs6("div", { style: SECTION_HEAD, children: [
      /* @__PURE__ */ jsx6("span", { style: SECTION_LABEL, children: "Storm forecast" }),
      /* @__PURE__ */ jsx6(
        "span",
        {
          style: sectionValueStyle(
            state === "none" ? "go" : state === "unknown" ? "info" : "warn"
          ),
          children: headline
        }
      )
    ] }),
    /* @__PURE__ */ jsxs6(
      "svg",
      {
        viewBox: "0 0 100 14",
        preserveAspectRatio: "none",
        width: "100%",
        height: "16",
        role: "img",
        "aria-label": headline,
        children: [
          phases.map((p) => {
            const x = acc;
            acc += p.w;
            return /* @__PURE__ */ jsx6(
              "rect",
              {
                x,
                y: 3,
                width: p.w - 0.6,
                height: 8,
                rx: 1,
                fill: TONE_HEX[p.tone],
                opacity: 0.9
              },
              p.key
            );
          }),
          nowPct !== null && /* @__PURE__ */ jsxs6(Fragment2, { children: [
            /* @__PURE__ */ jsx6(
              "line",
              {
                x1: nowPct,
                y1: 0,
                x2: nowPct,
                y2: 14,
                stroke: "var(--color-text-primary)",
                strokeWidth: 0.8
              }
            ),
            /* @__PURE__ */ jsx6(
              "circle",
              {
                cx: nowPct,
                cy: 1.6,
                r: 1.6,
                fill: "var(--color-text-primary)"
              }
            )
          ] })
        ]
      }
    )
  ] });
}
function BeltRings({
  inner,
  outer,
  magnetosphere,
  altitudeKm
}) {
  const cx = 50;
  const cy = 50;
  const rings = [
    {
      r: 48,
      tone: "info",
      label: "Magnetopause",
      active: magnetosphere
    },
    { r: 40, tone: "warn", label: "Outer belt", active: outer },
    { r: 26, tone: "nogo", label: "Inner belt", active: inner }
  ];
  const vr = inner || outer ? inner ? 26 : 40 : altitudeKm === null ? null : 12 + Math.min(1, Math.max(0, altitudeKm / 8e3)) * 36;
  const vesselTone = inner ? "nogo" : outer ? "warn" : magnetosphere ? "go" : "info";
  return /* @__PURE__ */ jsxs6(
    "svg",
    {
      viewBox: "0 0 100 100",
      style: {
        maxHeight: "100%",
        maxWidth: "100%",
        width: "auto",
        height: "100%"
      },
      role: "img",
      "aria-label": vr === null ? "Radiation belts, vessel position unknown" : "Radiation belt position",
      children: [
        rings.map((ring) => /* @__PURE__ */ jsx6(
          "circle",
          {
            cx,
            cy,
            r: ring.r,
            fill: "none",
            stroke: TONE_HEX[ring.tone],
            strokeWidth: ring.active ? 2.4 : 1,
            opacity: ring.active ? 1 : 0.35,
            strokeDasharray: ring.active ? void 0 : "2 2"
          },
          ring.label
        )),
        outer && !inner && /* @__PURE__ */ jsx6("circle", { cx, cy, r: 40, fill: TONE_HEX.warn, opacity: 0.08 }),
        inner && /* @__PURE__ */ jsx6("circle", { cx, cy, r: 26, fill: TONE_HEX.nogo, opacity: 0.1 }),
        /* @__PURE__ */ jsx6(
          "circle",
          {
            cx,
            cy,
            r: 12,
            fill: "var(--color-accent-fg)",
            opacity: 0.85
          }
        ),
        vr !== null && /* @__PURE__ */ jsx6(
          "circle",
          {
            cx: cx + vr,
            cy,
            r: 3,
            fill: TONE_HEX[vesselTone],
            stroke: "var(--color-text-primary)",
            strokeWidth: 0.6
          }
        )
      ]
    }
  );
}
function SolarWindChart({
  radiation,
  storm,
  seed,
  points = 64
}) {
  const rng = mulberry32(seed || 1);
  const amp = (0.12 + doseFraction(radiation) * 0.8) * (storm ? 1.25 : 1);
  const tone = doseTone(radiation);
  const W = 100;
  const H = 30;
  const mid = H * 0.55;
  const step = W / (points - 1);
  let d = `M 0 ${mid.toFixed(2)}`;
  for (let i = 0; i < points; i++) {
    const x = i * step;
    const n = (rng() - 0.5) * 2 + (rng() - 0.5);
    const y = Math.max(1, Math.min(H - 1, mid - n * amp * mid));
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  return /* @__PURE__ */ jsxs6(
    "svg",
    {
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "none",
      width: "100%",
      height: "100%",
      role: "img",
      "aria-label": "Solar-wind and radiation-field flux",
      children: [
        /* @__PURE__ */ jsx6("path", { d: area, fill: TONE_HEX[tone], opacity: 0.16 }),
        /* @__PURE__ */ jsx6("path", { d, fill: "none", stroke: TONE_HEX[tone], strokeWidth: 0.9 })
      ]
    }
  );
}
function SpaceWeatherComponent({
  w,
  h
}) {
  const read3 = useSpaceWeather();
  const nowUt = magnitudeOf10(useViewUt());
  const factsReading = useProcessor3(CELESTIAL_FACTS);
  const facts = factsReading?.state === "observed" || factsReading?.state === "held" ? factsReading.value : void 0;
  const identityReading = useStream("vessel.identity");
  const parentIndex = identityReading.state === "observed" || identityReading.state === "held" ? identityReading.value.parentBodyIndex : void 0;
  const fallbackBodyName = parentIndex == null ? void 0 : facts?.nameByIndex[parentIndex];
  if (!read3.readable) {
    return /* @__PURE__ */ jsx6(
      Panel2,
      {
        panelTitle: "Space Weather",
        compactTitle: ["SPACE WX", "WX"],
        sections: /* @__PURE__ */ jsx6(Section3, { fill: true, children: /* @__PURE__ */ jsx6(EmptyState2, { layout: "fill", role: "status", "aria-live": "polite", children: ABSENCE_TEXT[read3.absence] }) })
      }
    );
  }
  const d = read3.data;
  const status = statusFor(d, read3.held);
  const positionUnknown = d.altitudeKm === null && !d.innerBelt && !d.outerBelt;
  const cols = w ?? 8;
  const rows = h ?? 8;
  const compact = cols < 7 || rows < 6;
  const doseText = d.radiationRadPerHour === null ? NULL_DISPLAY3 : `${d.radiationRadPerHour.toFixed(d.radiationRadPerHour < 1 ? 3 : 2)} rad/h`;
  const shielding = d.shieldingValue !== null && d.shieldingCapacity !== null && d.shieldingCapacity > 0 ? {
    fraction: d.shieldingValue / d.shieldingCapacity,
    label: `${d.shieldingValue.toFixed(1)} / ${d.shieldingCapacity.toFixed(1)}`
  } : null;
  const shieldFrac = shielding?.fraction ?? null;
  const allStorms = d.storms.map(
    (s, i) => deriveStorm(s, i, nowUt, d.stormEjectionSpeedMps)
  );
  const activeStorms = allStorms.filter((s) => s.state !== 0);
  return /* @__PURE__ */ jsx6(
    Panel2,
    {
      panelTitle: "Space Weather",
      compactTitle: ["SPACE WX", "WX"],
      panelAside: /* @__PURE__ */ jsx6(
        Badge5,
        {
          role: "status",
          "aria-live": "polite",
          tone: status.tone === "go" ? "go" : status.tone === "nogo" ? "nogo" : "warn",
          children: status.label
        }
      ),
      sections: [
        read3.held && /* @__PURE__ */ jsx6(Section3, { full: true, children: /* @__PURE__ */ jsx6(Text4, { tone: "warn", size: "xs", role: "status", "aria-live": "polite", children: "Space weather held: the dose, shielding, stars and CMEs are the last reported, and the craft's position in the belts is unknown." }) }, "dated"),
        /* Sun vantage first: the widget's subject is what the STAR is doing,
           and the vessel-local consequence below is downstream of it. */
        /* @__PURE__ */ jsxs6(Section3, { children: [
          /* @__PURE__ */ jsx6(SectionTitle, { children: "Stars" }),
          d.stars.length === 0 ? /* @__PURE__ */ jsx6(EmptyState2, { children: "No stars detected yet." }) : (
            // `justify="start"`, not Cluster's default `between`: with one or two
            // stars, space-between shoves the cards to opposite edges with a
            // canyon between them, which reads as broken rather than as "not much
            // going on". Packing left with a fixed card width is what scales from
            // a lone star to a five-star system, wrapping instead of stretching.
            /* @__PURE__ */ jsx6(Cluster5, { wrap: true, justify: "start", children: d.stars.map((star) => {
              const name = star.star ?? "Unknown star";
              const activity = starActivity(allStorms, name);
              return /* @__PURE__ */ jsx6(
                Card2,
                {
                  tone: SEVERITY_CARD_TONE[activity.severity],
                  style: { width: 128, flexShrink: 0 },
                  top: /* @__PURE__ */ jsx6(
                    StarDiagram,
                    {
                      starName: name,
                      activity,
                      compact
                    }
                  ),
                  title: name,
                  children: /* @__PURE__ */ jsx6(Text4, { level: "muted", size: "xs", children: /* @__PURE__ */ jsx6(Unit4, { value: star.distance }) })
                },
                name
              );
            }) })
          )
        ] }, "stars"),
        /* @__PURE__ */ jsxs6(Section3, { children: [
          /* @__PURE__ */ jsx6(SectionTitle, { children: "CME tracker" }),
          activeStorms.length === 0 ? /* @__PURE__ */ jsx6(EmptyState2, { children: "No inbound CMEs detected." }) : /* @__PURE__ */ jsx6(Stack4, { children: activeStorms.map((storm) => /* @__PURE__ */ jsx6(
            StormCard,
            {
              storm,
              compact,
              fallbackBodyName
            },
            storm.key
          )) })
        ] }, "cme"),
        /* @__PURE__ */ jsx6(Section3, { full: true, children: /* @__PURE__ */ jsx6(StormTimeline, { state: d.stormState }) }, "timeline"),
        /* @__PURE__ */ jsx6(Section3, { full: true, children: /* @__PURE__ */ jsxs6("div", { style: midRowStyle(compact), children: [
          /* @__PURE__ */ jsxs6("div", { style: RINGS_SLOT, children: [
            /* @__PURE__ */ jsx6(
              BeltRings,
              {
                inner: d.innerBelt,
                outer: d.outerBelt,
                magnetosphere: d.magnetosphere,
                altitudeKm: d.altitudeKm
              }
            ),
            positionUnknown && // Says WHY the dot is gone. A diagram missing its "you are here"
            // marker otherwise reads as a widget that failed to draw one.
            /* @__PURE__ */ jsx6("span", { style: POSITION_UNKNOWN_TAG, children: "Position unknown" }),
            d.blackout && /* @__PURE__ */ jsx6("span", { style: BLACKOUT_TAG, children: "Comms blackout" })
          ] }),
          /* @__PURE__ */ jsxs6("div", { style: DOSE_SLOT, children: [
            /* @__PURE__ */ jsx6(
              "div",
              {
                style: doseValueStyle(doseTone(d.radiationRadPerHour), compact),
                children: doseText
              }
            ),
            /* @__PURE__ */ jsx6("div", { style: DOSE_CAPTION, children: "habitat dose rate" })
          ] })
        ] }) }, "environment"),
        !compact ? /* @__PURE__ */ jsx6(Section3, { full: true, children: /* @__PURE__ */ jsxs6("div", { style: FLUX_SECTION, children: [
          /* @__PURE__ */ jsx6(ReadoutCaption2, { style: SPACED_CAPTION, children: "Solar-wind flux" }),
          /* @__PURE__ */ jsx6("div", { style: CHART_SLOT, children: d.radiationRadPerHour === null ? /* @__PURE__ */ jsx6(EmptyState2, { children: "Flux needs a dose rate" }) : /* @__PURE__ */ jsx6(
            SolarWindChart,
            {
              radiation: d.radiationRadPerHour,
              storm: d.stormState === "inprogress",
              seed: d.seed
            }
          ) })
        ] }) }, "flux") : null,
        /* @__PURE__ */ jsx6(Section3, { full: true, children: /* @__PURE__ */ jsxs6("div", { style: FOOTER_ROW, children: [
          /* @__PURE__ */ jsx6(
            Meter2,
            {
              label: "Shielding",
              value: shieldFrac === null ? null : value9("ratio", shieldFrac),
              tone: shieldFrac === null ? "info" : shieldFrac >= 0.6 ? "go" : shieldFrac >= 0.3 ? "warn" : "nogo",
              valueLabel: shielding?.label
            }
          ),
          !compact && /* @__PURE__ */ jsxs6("div", { style: ENV_ROW, children: [
            /* @__PURE__ */ jsx6("span", { style: envTagStyle(d.magnetosphere), children: "Magnetosphere" }),
            /* @__PURE__ */ jsx6("span", { style: envTagStyle(d.outerBelt, "warn"), children: "Outer belt" }),
            /* @__PURE__ */ jsx6("span", { style: envTagStyle(d.innerBelt, "nogo"), children: "Inner belt" })
          ] })
        ] }) }, "shielding")
      ]
    }
  );
}
var STAT_SECTION = {
  marginTop: "var(--gap-related-comfortable)"
};
var SECTION_HEAD = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "var(--gap-related)"
};
var SECTION_LABEL = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em"
};
function sectionValueStyle(tone) {
  return {
    fontSize: "var(--font-size-caption)",
    color: TONE_HEX[tone],
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  };
}
function midRowStyle(compact) {
  return {
    flex: "0 0 auto",
    height: compact ? "68px" : "86px",
    display: "grid",
    gridTemplateColumns: compact ? "minmax(64px, 36%) 1fr" : "minmax(90px, 42%) 1fr",
    alignItems: "stretch",
    // A belt diagram beside a numeric dose readout: two different kinds of
    // thing sharing a row, which is the section gap rather than the related
    // one. It is the column gap only, the row being single.
    gap: "var(--gap-section)",
    marginTop: compact ? "var(--gap-sub-readout)" : "var(--gap-readout-groups)",
    minHeight: 0,
    overflow: "hidden"
  };
}
var FLUX_SECTION = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-readout-groups)",
  minHeight: 0
};
var RINGS_SLOT = {
  position: "relative",
  height: "100%",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden"
};
var BLACKOUT_TAG = {
  position: "absolute",
  bottom: "2px",
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  // Text sitting ON the nogo-bg fill, not beside it: -fg (2.61:1 here) fails
  // the 4.5:1 AA floor. -on-bg is the token for exactly this case.
  color: "var(--color-nogo-on-status)",
  background: "var(--color-nogo-status)",
  borderRadius: "var(--radius-regular)",
  padding: "var(--inset-chip)",
  whiteSpace: "nowrap"
};
var POSITION_UNKNOWN_TAG = {
  position: "absolute",
  top: "2px",
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
  padding: "var(--inset-chip)",
  whiteSpace: "nowrap"
};
var DOSE_SLOT = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0
};
var DOSE_FONT_COMPACT = "19px";
var DOSE_FONT_FULL = "23px";
function doseValueStyle(tone, compact) {
  return {
    fontSize: compact ? DOSE_FONT_COMPACT : DOSE_FONT_FULL,
    fontWeight: 700,
    lineHeight: 1.05,
    color: TONE_HEX[tone],
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    flex: "0 0 auto"
  };
}
var DOSE_CAPTION = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em"
};
var SPACED_CAPTION = {
  display: "block",
  marginTop: "var(--gap-related-comfortable)"
};
var CHART_SLOT = {
  flex: "0 0 auto",
  height: "44px",
  width: "100%"
};
var FOOTER_ROW = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  marginTop: "auto",
  paddingTop: "var(--gap-related-compact)"
};
var ENV_ROW = {
  display: "flex",
  gap: "var(--gap-related)",
  flexWrap: "wrap"
};
function envTagStyle(on, tone) {
  const active = TONE_HEX[tone ?? "go"];
  return {
    fontSize: "var(--font-size-caption)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "var(--inset-chip)",
    borderRadius: "var(--radius-regular)",
    border: `1px solid ${on ? active : "var(--color-border-subtle)"}`,
    color: on ? active : "var(--color-text-muted)",
    opacity: on ? 1 : 0.5,
    whiteSpace: "nowrap"
  };
}
registerComponent2({
  id: "space-weather",
  name: "Space Weather",
  description: "Solar activity and radiation: each star's activity, coronal mass ejections with departure, transit progress, impact ETA and what they will hit, and the craft's own habitat dose rate, belt and magnetopause position and shielding.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 3, h: 4 },
  component: SpaceWeatherComponent,
  channels: ["kerbalism.spaceweather"],
  optionalChannels: ["vessel.flight"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  owner: KERBALISM
});

// src/lastValue.ts
function lastValue(reading) {
  return reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
}

// src/SpaceWeather/badge.ts
function spaceWeatherBadges(weather, held) {
  if (!weather) return null;
  const marked = held === void 0 ? {} : { held };
  if (weather.stormInProgress === true) {
    return [
      {
        id: "space-weather-status",
        label: "Storm in progress",
        tone: "nogo",
        ...marked
      }
    ];
  }
  if (weather.stormIncoming === true || weather.innerBelt === true || weather.outerBelt === true) {
    return [
      { id: "space-weather-status", label: "Exposed", tone: "warn", ...marked }
    ];
  }
  return null;
}
KERBALISM.registerContribution({
  id: "space-weather-badge",
  contributes: "space-weather.badges",
  deps: ["kerbalism.spaceweather"],
  requires: "kerbalism",
  compute: (topics) => spaceWeatherBadges(
    lastValue(topics["kerbalism.spaceweather"]),
    topics["kerbalism.spaceweather"]
  )
});

// src/SystemViewCme/contribution.ts
import { magnitudeOf as magnitudeOf11 } from "@ksp-gonogo/ui-kit";
var STORM_STATE_INBOUND = 1;
var STORM_STATE_IN_PROGRESS = 2;
function stormStateLabel(state) {
  if (state === STORM_STATE_INBOUND) return "inbound";
  if (state === STORM_STATE_IN_PROGRESS) return "in progress";
  return "unknown";
}
function bearingMetres(direction, distMetres) {
  if (!direction) return null;
  const dx = magnitudeOf11(direction.x);
  const dy = magnitudeOf11(direction.y);
  const dz = magnitudeOf11(direction.z);
  if (dx == null || dy == null || dz == null) return null;
  const mag = Math.hypot(dx, dy, dz);
  if (!(mag > 0)) return null;
  return {
    xMetres: -dx / mag * distMetres || 0,
    yMetres: -dz / mag * distMetres || 0,
    zMetres: -dy / mag * distMetres || 0
  };
}
function computeCmeEntities(weather, held = false) {
  if (!weather) return [];
  const ejectionSpeedMps = magnitudeOf11(weather.stormEjectionSpeed);
  const entities = [];
  for (const storm of weather.storms ?? []) {
    const entity = computeStormEntity(
      storm,
      weather.stars,
      ejectionSpeedMps,
      held
    );
    if (entity) entities.push(entity);
  }
  return entities;
}
function computeStormEntity(storm, stars, ejectionSpeedMps, held) {
  const state = magnitudeOf11(storm.stormState);
  if (state == null || state === 0) return null;
  if (typeof storm.star !== "string" || storm.star.length === 0) return null;
  const dist = magnitudeOf11(storm.dist);
  if (dist == null || !(dist > 0)) return null;
  const starInfo = stars?.find((s) => s.star === storm.star);
  const bearing = bearingMetres(starInfo?.direction, dist);
  if (!bearing) return null;
  const durationS = magnitudeOf11(storm.stormDuration);
  if (durationS == null || !(durationS > 0)) return null;
  if (ejectionSpeedMps == null || !(ejectionSpeedMps > 0)) return null;
  const segmentLengthMetres = Math.min(durationS * ejectionSpeedMps, dist);
  const arrivalUt = magnitudeOf11(storm.stormTime);
  if (arrivalUt == null || !Number.isFinite(arrivalUt)) return null;
  const meta = {
    star: storm.star,
    state: stormStateLabel(state),
    distM: dist,
    durationS,
    ejectionSpeedMps,
    arrivalUt
  };
  return {
    id: `cme:${storm.star}`,
    // Fixed at the star's own position (the pulse's apex): this entity only
    // projects when the diagram's current frame IS that star (SystemView's
    // "root parent" frame setting, the whole-system view a CME threatening
    // the whole neighbourhood belongs on), same off-frame degrade every
    // other entity gets.
    position: {
      kind: "fixed",
      parentName: storm.star,
      xMetres: 0,
      yMetres: 0,
      zMetres: 0
    },
    shape: {
      kind: "travelling-pulse",
      to: { kind: "fixed", parentName: storm.star, ...bearing },
      segmentLengthMetres,
      arriveUt: arrivalUt,
      // Kerbalism's own `storm_duration` is exactly "how long the storm
      // stays active once it hits" (this contract's own `StormDuration` doc
      // comment): the real UT the trailing edge clears the target.
      clearUt: arrivalUt + durationS
    },
    // Faint while inbound, normal once arrived: an ambient effect that stacks
    // under the CommNet graph and point markers (the travelling pulse's own
    // default layer sits below connection-line and point), never brighter
    // than that tier. The tone never changes with state, only the
    // emphasis, so "arrived" reads as more present without the marker
    // cutting off what is drawn on top or being mistaken for a selection.
    // `warn` is the meaning; which hue it becomes is SystemView's to decide.
    style: {
      emphasis: state === STORM_STATE_IN_PROGRESS ? "normal" : "faint",
      tone: "warn"
    },
    meta,
    ...held ? { currency: "held" } : {}
  };
}
KERBALISM.registerContribution({
  id: "system-view-cme",
  contributes: "tracking-station.entities",
  deps: ["kerbalism.spaceweather"],
  requires: "kerbalism",
  compute: (topics) => computeCmeEntities(
    lastValue(topics["kerbalism.spaceweather"]),
    topics["kerbalism.spaceweather"].state === "held"
  )
});

// src/ShipMap/partMeta.ts
import { magnitudeOf as magnitudeOf12 } from "@ksp-gonogo/ui-kit";
function computeKerbalismPartMeta(lifeSupport, held) {
  if (!lifeSupport) return [];
  const entries = [];
  for (const entry of lifeSupport.processes ?? []) {
    const flightId = magnitudeOf12(entry.flightId);
    if (flightId === null) continue;
    const label = entry.title || entry.resource || "process";
    const running = entry.running === true;
    const broken = entry.broken === true;
    const unread = entry.broken == null || entry.running == null;
    entries.push({
      partId: String(flightId),
      label,
      tone: broken ? "nogo" : running ? "go" : unread ? "warn" : "neutral",
      kind: "text",
      text: broken ? "broken" : running ? "running" : unread ? "unknown" : "idle",
      ...held === void 0 ? {} : { held }
    });
  }
  return entries;
}
KERBALISM.registerContribution({
  id: "ship-map-part-meta",
  contributes: "ship-map.part-meta",
  deps: ["kerbalism.lifesupport"],
  requires: "kerbalism",
  compute: (topics) => computeKerbalismPartMeta(
    lastValue(topics["kerbalism.lifesupport"]),
    topics["kerbalism.lifesupport"]
  )
});

// src/ShipMap/partMeters.ts
import {
  value as quantity
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf13, magnitudeOr as magnitudeOr5 } from "@ksp-gonogo/ui-kit";
var DEFAULT_LOW_THRESHOLD = 0.15;
var CRITICAL_FRACTION_OF_LOW = 0.33;
function partMeterStatus(amount, capacity, lowThreshold) {
  if (capacity <= 0) return null;
  const low = lowThreshold === void 0 ? DEFAULT_LOW_THRESHOLD : magnitudeOr5(lowThreshold, DEFAULT_LOW_THRESHOLD);
  const ratio = amount / capacity;
  if (ratio < low * CRITICAL_FRACTION_OF_LOW) return "critical";
  if (ratio < low) return "low";
  return null;
}
function computeKerbalismPartMeters(wire, profile) {
  if (!wire || !profile) return [];
  const facts = resourceFacts(profile);
  const entries = [];
  for (const part of wire.parts) {
    for (const [name, flow] of Object.entries(part.resources)) {
      const fact = facts.get(name);
      if (!fact?.isSupply || fact.pooled !== false) continue;
      const capacity = magnitudeOr5(flow.maxAmount, 0);
      if (capacity <= 0) continue;
      const amount = magnitudeOf13(flow.amount);
      if (amount === null) continue;
      entries.push({
        partId: String(part.id),
        resource: name,
        displayName: fact.displayName,
        amount: quantity("units", amount),
        capacity: quantity("units", capacity),
        status: partMeterStatus(
          amount,
          capacity,
          profile.resources?.[name]?.lowThreshold
        )
      });
    }
  }
  return entries;
}
function amountReading(parts, amount) {
  if (parts.state === "observed") {
    return {
      state: "observed",
      value: amount,
      atUt: parts.atUt,
      reckoning: { status: "none" }
    };
  }
  if (parts.state === "held") {
    return {
      state: "held",
      value: amount,
      asOfUt: parts.asOfUt,
      grade: parts.grade,
      reckoning: { status: "none" }
    };
  }
  return { state: parts.state, reckoning: { status: "none" } };
}
function kerbalismPartMeterReadings(parts, profile) {
  if (parts?.state !== "observed" && parts?.state !== "held") return [];
  return computeKerbalismPartMeters(parts.value, profile).map((entry) => ({
    ...entry,
    amount: "state" in entry.amount ? entry.amount : amountReading(parts, entry.amount)
  }));
}
KERBALISM.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  deps: ["vessel.parts", "kerbalism.profile"],
  requires: "kerbalism",
  compute: (topics) => kerbalismPartMeterReadings(
    topics["vessel.parts"],
    lastValue(topics["kerbalism.profile"])
  )
});

// src/ResourceOps/processFilters.ts
function computeKerbalismProcessTerms(converters) {
  const titles = /* @__PURE__ */ new Set();
  for (const converter of converters ?? []) {
    const title = readKerbalismIsruConverterExt(converter)?.title?.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}
KERBALISM.registerContribution({
  id: "resource-ops-processes",
  contributes: "resource-ops.filters",
  deps: ["isru.converters"],
  requires: "kerbalism",
  compute: (topics) => computeKerbalismProcessTerms(lastValue(topics["isru.converters"]))
});

// src/ScienceFileManager/index.tsx
import {
  readingOf,
  registerAugment as registerAugment4,
  useCommand,
  useTelemetry as useTelemetry5
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge6,
  Cluster as Cluster6,
  CommandButton,
  Section as Section4,
  Stack as Stack5,
  Text as Text5,
  Unit as Unit5
} from "@ksp-gonogo/ui-kit";

// src/ScienceFileManager/useTransferRailEntry.ts
import { useTelemetry as useTelemetry4 } from "@ksp-gonogo/sitrep-sdk";
import { useRailEntry } from "@ksp-gonogo/ui-kit";
import { useRef } from "react";

// src/ScienceFileManager/transferTrace.ts
import { railTagsForTelemetry } from "@ksp-gonogo/sitrep-sdk";
var KERBALISM_TRANSFER_TAGS = railTagsForTelemetry("continuous");
var TRANSFER_STEP_SECONDS = 1;
var HISTORY_SAMPLES = 900;
var MAX_BRIDGE_SECONDS = 3;
var EMPTY_TRANSFER_TRACE = {
  samples: [],
  lastUt: null
};
function foldTransferObservation(trace, atUt, rateMBps, transmitting) {
  if (rateMBps === null || transmitting === null) return trace;
  if (trace.lastUt !== null && atUt <= trace.lastUt) return trace;
  const rate = transmitting ? Math.max(rateMBps, 0) : 0;
  const prior = trace.samples[trace.samples.length - 1];
  const bridged = trace.lastUt !== null && prior !== void 0 && atUt - trace.lastUt <= MAX_BRIDGE_SECONDS;
  const held = bridged ? Array.from(
    {
      length: Math.max(
        Math.round(
          (atUt - trace.lastUt) / TRANSFER_STEP_SECONDS
        ) - 1,
        0
      )
    },
    () => prior
  ) : [];
  const base = bridged ? trace.samples : [];
  const samples = [...base, ...held, rate].slice(-HISTORY_SAMPLES);
  return { samples, lastUt: atUt };
}
function transferTraceVisible(trace) {
  return trace.samples.some((a) => a > 0);
}
function transferAmplitudes(trace) {
  const peak = Math.max(0, ...trace.samples);
  return trace.samples.map((r) => peak > 0 ? r / peak : 0);
}

// src/ScienceFileManager/useTransferRailEntry.ts
function useTransferRailEntry(experimentsReading, file, subjectId, label) {
  const delay = useTelemetry4("comms.delay");
  const oneWaySeconds = delay.state === "observed" ? delay.value.oneWaySeconds?.magnitude ?? null : null;
  const trace = useRef(EMPTY_TRANSFER_TRACE);
  const lastFolded = useRef(null);
  if (experimentsReading.state === "observed" && lastFolded.current !== experimentsReading) {
    lastFolded.current = experimentsReading;
    trace.current = file ? foldTransferObservation(
      trace.current,
      experimentsReading.atUt.magnitude,
      file.transmitRateMBps?.magnitude ?? null,
      file.transmitting ?? null
    ) : trace.current;
  }
  const current = trace.current;
  const ribbonLabel = `${label} transferring to the ground`;
  useRailEntry(
    transferTraceVisible(current) ? {
      inFlight: [],
      tags: KERBALISM_TRANSFER_TAGS,
      effectiveDelaySeconds: oneWaySeconds,
      "aria-label": ribbonLabel,
      ribbons: [
        {
          id: `kerbalism.transfer.${subjectId}`,
          label: ribbonLabel,
          oneWaySeconds,
          amplitudes: transferAmplitudes(current),
          ...oneWaySeconds === null ? {} : { spanSamples: oneWaySeconds / TRANSFER_STEP_SECONDS },
          tags: KERBALISM_TRANSFER_TAGS
        }
      ]
    } : null
  );
}

// src/ScienceFileManager/index.tsx
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function stillTrue(reading, whenConfirmedNothing) {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "held") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return void 0;
}
function findDriveEntries(experiments, subjectId) {
  const out = {};
  if (!experiments) return out;
  for (const entry of experiments) {
    if (entry.subjectId !== subjectId) continue;
    const ext = readKerbalismScienceExperimentExt(entry);
    if (!ext) continue;
    if (ext.kind === "file") out.file = ext;
    else if (ext.kind === "sample") out.sample = ext;
  }
  return out;
}
function DriveCapacity({
  ext,
  dated
}) {
  const hasStorage = ext.storageCapacityMB != null && ext.storageUsedMB != null;
  const hasSlots = ext.sampleSlotsTotal != null && ext.sampleSlotsUsed != null;
  if (!hasStorage && !hasSlots) return null;
  return /* @__PURE__ */ jsxs7(Text5, { size: "xs", level: "muted", children: [
    "Drive",
    " ",
    hasStorage && /* @__PURE__ */ jsxs7(Fragment3, { children: [
      /* @__PURE__ */ jsx7(Unit5, { value: dated(ext.storageUsedMB) }),
      " /",
      " ",
      /* @__PURE__ */ jsx7(Unit5, { value: dated(ext.storageCapacityMB) })
    ] }),
    hasStorage && hasSlots && " \xB7 ",
    hasSlots && /* @__PURE__ */ jsxs7(Fragment3, { children: [
      /* @__PURE__ */ jsx7(Unit5, { value: dated(ext.sampleSlotsUsed) }),
      "/",
      /* @__PURE__ */ jsx7(Unit5, { value: dated(ext.sampleSlotsTotal) }),
      " slots"
    ] })
  ] });
}
var UNREAD_FLAG_TITLE = "Kerbalism did not report this flag, so its current state is unknown";
function flagState(flag) {
  if (flag == null) return { read: false, on: false, next: false };
  return { read: true, on: flag, next: !flag };
}
function ScienceDataAboardRowAugment({
  subjectId
}) {
  const experimentsReading = useTelemetry5("science.experiments");
  const experiments = stillTrue(experimentsReading, void 0);
  const held = experimentsReading.state === "held";
  const dated = (figure) => figure == null ? null : readingOf(experimentsReading, () => figure);
  const labs = stillTrue(useTelemetry5("science.lab"), void 0);
  const sendCmd = useCommand("kerbalism.file.send");
  const deleteCmd = useCommand("kerbalism.file.delete");
  const analyzeCmd = useCommand("kerbalism.sample.analyze");
  const dumpCmd = useCommand("kerbalism.sample.dump");
  const moveCmd = useCommand("kerbalism.sample.moveToLab");
  const { file, sample } = findDriveEntries(experiments, subjectId);
  useTransferRailEntry(
    experimentsReading,
    file,
    subjectId,
    experiments?.find((e) => e.subjectId === subjectId)?.title || subjectId
  );
  if (!file && !sample) return null;
  const hasLab = (labs?.length ?? 0) > 0;
  const driveExt = file ?? sample;
  const send = flagState(file?.sendFlagged);
  const analyze = flagState(sample?.analyze);
  return /* @__PURE__ */ jsxs7(
    Section4,
    {
      style: { paddingLeft: "var(--indent-row)" },
      "aria-label": "Kerbalism file manager",
      children: [
        file && /* @__PURE__ */ jsxs7(Stack5, { children: [
          /* @__PURE__ */ jsxs7(Cluster6, { wrap: true, justify: "start", children: [
            file.dataSizeMB != null && /* @__PURE__ */ jsx7(Text5, { size: "xs", children: /* @__PURE__ */ jsx7(Unit5, { value: dated(file.dataSizeMB) }) }),
            file.transmitRateMBps?.isPositive() && /* @__PURE__ */ jsx7(Text5, { size: "xs", level: "muted", children: /* @__PURE__ */ jsx7(Unit5, { value: dated(file.transmitRateMBps) }) }),
            file.transmitting === true && /* @__PURE__ */ jsx7(
              Badge6,
              {
                tone: held ? "info" : "go",
                size: "sm",
                role: "status",
                "aria-live": "polite",
                children: held ? "Transmitting \xB7 held" : "Transmitting"
              }
            ),
            file.transmitting == null && /* @__PURE__ */ jsx7(Badge6, { tone: "warn", size: "sm", children: "Transmit unknown" })
          ] }),
          /* @__PURE__ */ jsxs7(Cluster6, { wrap: true, justify: "start", children: [
            /* @__PURE__ */ jsx7(
              CommandButton,
              {
                size: "sm",
                tone: "go",
                handle: sendCmd,
                args: { subjectId, flag: send.next },
                commandLabel: send.on ? "Cancel send" : "Send",
                pressed: send.on,
                disabled: !send.read,
                title: send.read ? void 0 : UNREAD_FLAG_TITLE,
                label: send.read ? send.on ? "Queued" : "Send" : "Unknown",
                pendingLabel: send.on ? "Cancelling..." : "Queueing...",
                "aria-label": send.read ? send.on ? "Cancel send for file" : "Send file" : "Send file (send flag could not be read)"
              }
            ),
            /* @__PURE__ */ jsx7(
              CommandButton,
              {
                size: "sm",
                handle: deleteCmd,
                args: { subjectId },
                commandLabel: "Delete file",
                label: "Delete",
                confirmLabel: "Confirm",
                confirmTone: "nogo",
                pendingLabel: "Deleting...",
                "aria-label": "Delete file",
                confirmAriaLabel: "Confirm delete file"
              }
            )
          ] })
        ] }),
        sample && /* @__PURE__ */ jsxs7(Stack5, { children: [
          /* @__PURE__ */ jsx7(Cluster6, { wrap: true, justify: "start", children: sample.sampleMass != null && /* @__PURE__ */ jsx7(Text5, { size: "xs", children: /* @__PURE__ */ jsx7(Unit5, { value: dated(sample.sampleMass) }) }) }),
          /* @__PURE__ */ jsxs7(Cluster6, { wrap: true, justify: "start", children: [
            /* @__PURE__ */ jsx7(
              CommandButton,
              {
                size: "sm",
                tone: "go",
                handle: analyzeCmd,
                args: { subjectId, flag: analyze.next },
                commandLabel: analyze.on ? "Cancel analyze" : "Analyze",
                pressed: analyze.on,
                disabled: !analyze.read,
                title: analyze.read ? void 0 : UNREAD_FLAG_TITLE,
                label: analyze.read ? analyze.on ? "Analyzing" : "Analyze" : "Unknown",
                pendingLabel: analyze.on ? "Cancelling..." : "Flagging...",
                "aria-label": analyze.read ? analyze.on ? "Cancel analyze for sample" : "Flag sample for analysis" : "Flag sample for analysis (analyze flag could not be read)"
              }
            ),
            /* @__PURE__ */ jsx7(
              CommandButton,
              {
                size: "sm",
                handle: moveCmd,
                args: { subjectId },
                commandLabel: "Move to lab",
                label: "Move to lab",
                pendingLabel: "Moving...",
                disabled: !hasLab,
                title: hasLab ? void 0 : "No lab part aboard this vessel",
                "aria-label": hasLab ? "Move sample to lab" : "Move sample to lab (no lab part aboard this vessel)"
              }
            ),
            /* @__PURE__ */ jsx7(
              CommandButton,
              {
                size: "sm",
                handle: dumpCmd,
                args: { subjectId },
                commandLabel: "Dump sample",
                label: "Dump",
                confirmLabel: "Confirm",
                confirmTone: "nogo",
                pendingLabel: "Dumping...",
                "aria-label": "Dump sample",
                confirmAriaLabel: "Confirm dump sample"
              }
            )
          ] })
        ] }),
        driveExt && /* @__PURE__ */ jsx7(DriveCapacity, { ext: driveExt, dated })
      ]
    }
  );
}
registerAugment4({
  id: "science-data-aboard-row-file-manager",
  augments: "science-data.aboard-row",
  component: ScienceDataAboardRowAugment,
  requires: "kerbalism",
  owner: KERBALISM
});

// src/Reliability/index.tsx
import { registerAugment as registerAugment5, useTelemetry as useTelemetry6 } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge7,
  Card as Card3,
  Cluster as Cluster8,
  heldWord,
  magnitudeOf as magnitudeOf16,
  Stack as Stack7,
  Text as Text7,
  worstSeverity
} from "@ksp-gonogo/ui-kit";

// src/Reliability/RepairControl.tsx
import { useCommand as useCommand2 } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Cluster as Cluster7,
  CommandButton as CommandButton2,
  SelectableRow,
  Stack as Stack6,
  Text as Text6
} from "@ksp-gonogo/ui-kit";
import { useState as useState2 } from "react";

// src/Reliability/repair.ts
import { magnitudeOf as magnitudeOf14 } from "@ksp-gonogo/ui-kit";
function carriedOf(member, itemName) {
  let held = 0;
  for (const item of member.carrying ?? []) {
    if (item.name === itemName) held += magnitudeOf14(item.quantity) ?? 0;
  }
  return held;
}
function actionable(condition) {
  return condition === "failed" || condition === "failed-critical" || condition === "service-due";
}
function verbFor(condition) {
  return condition === "service-due" ? "Service" : "Repair";
}
function mayAct(member, trait, level) {
  if (trait) {
    const accepted = trait.split(",").map((t) => t.trim().toLowerCase());
    if (!accepted.includes((member.trait ?? "").toLowerCase())) return false;
  }
  if (level != null && (magnitudeOf14(member.experienceLevel) ?? 0) < level) {
    return false;
  }
  return true;
}
function repairCostResolver(crew, stores) {
  const aboard = /* @__PURE__ */ new Map();
  for (const store of stores) {
    for (const item of store.items ?? []) {
      const seen = aboard.get(item.name);
      aboard.set(item.name, {
        quantity: (seen?.quantity ?? 0) + (magnitudeOf14(item.quantity) ?? 0),
        title: seen?.title ?? item.title
      });
    }
  }
  const titleOf = (name) => {
    const stored = aboard.get(name)?.title;
    if (stored) return stored;
    for (const member of crew) {
      for (const item of member.carrying ?? []) {
        if (item.name === name && item.title) return item.title;
      }
    }
    return void 0;
  };
  return (cost) => (cost ?? []).map((item) => ({
    name: item.name,
    label: titleOf(item.name) ?? item.name,
    needed: magnitudeOf14(item.quantity) ?? 0,
    reserve: aboard.get(item.name)?.quantity ?? 0
  }));
}

// src/Reliability/RepairControl.tsx
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function costWords(cost) {
  return cost.map((line) => `${line.needed} \xD7 ${line.label}`).join(", ");
}
function refusalFor(eligibleCount, requirement, short) {
  if (eligibleCount === 0 && requirement) {
    return `Needs ${requirement}, and nobody aboard qualifies`;
  }
  if (eligibleCount === 0) return "Nobody is aboard to do it";
  if (short) {
    return `Needs ${short.needed} ${short.label}, and ${short.reachable} can be reached`;
  }
  return null;
}
function RepairControl({
  partId,
  condition,
  repairTrait,
  repairLevel,
  crew,
  cost
}) {
  const repair = useCommand2("kerbalism.repair");
  const [open, setOpen] = useState2(false);
  const [chosen, setChosen] = useState2(null);
  const verb = verbFor(condition);
  const price = cost.length > 0 ? `Costs ${costWords(cost)}` : null;
  const rankOn = cost[0]?.name;
  const eligible = crew.filter((c) => mayAct(c, repairTrait, repairLevel));
  const readiest = rankOn ? eligible.slice().sort((a, b) => carriedOf(b, rankOn) - carriedOf(a, rankOn))[0] : eligible[0];
  const performer = chosen ?? readiest?.name ?? null;
  const acting = eligible.find((c) => c.name === performer);
  const lines = cost.map((line) => {
    const carried = acting ? carriedOf(acting, line.name) : 0;
    return { ...line, carried, reachable: carried + line.reserve };
  });
  const short = lines.find((line) => line.reachable < line.needed);
  const requirement = repairTrait ? `${repairTrait}${repairLevel != null ? ` level ${repairLevel}` : ""}` : null;
  const refusal = refusalFor(eligible.length, requirement, short);
  if (!open) {
    return /* @__PURE__ */ jsxs8(Cluster7, { justify: "start", align: "baseline", children: [
      /* @__PURE__ */ jsx8(Button, { variant: "ghost", size: "sm", onClick: () => setOpen(true), children: verb }),
      price && /* @__PURE__ */ jsx8(Text6, { level: "muted", children: price })
    ] });
  }
  return /* @__PURE__ */ jsxs8(Stack6, { children: [
    lines.map((line) => /* @__PURE__ */ jsx8("span", { children: `${line.needed} \xD7 ${line.label} \xB7 ${line.carried} carried \xB7 ${line.reserve} aboard` }, line.name)),
    eligible.map((member) => /* @__PURE__ */ jsx8(
      SelectableRow,
      {
        selected: member.name === performer,
        onClick: () => setChosen(member.name ?? null),
        children: rankOn ? `${member.name ?? "Unknown"} \xB7 ${carriedOf(member, rankOn)} carried` : member.name ?? "Unknown"
      },
      member.name ?? "unknown"
    )),
    refusal && /* @__PURE__ */ jsx8("span", { children: refusal }),
    /* @__PURE__ */ jsx8(
      CommandButton2,
      {
        handle: repair,
        args: { partId, crewName: performer ?? "" },
        size: "sm",
        commandLabel: `${verb} with ${performer ?? "nobody"}`,
        label: verb,
        confirmLabel: price ? `Confirm, ${price.toLowerCase()}` : "Confirm",
        pendingLabel: `${verb}...`,
        disabled: refusal !== null,
        title: refusal ?? void 0
      }
    )
  ] });
}

// src/Reliability/rows.tsx
import { value as value10 } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf as magnitudeOf15, Unit as Unit6 } from "@ksp-gonogo/ui-kit";
import { Fragment as Fragment4, jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
var seconds = (magnitude) => value10("s", magnitude);
var SERVICE_ATTENTION = 0.9;
function serviceBudget(part) {
  return (part.budgets ?? []).find((budget) => budget.kind === "schedule");
}
function isNoteworthy(part) {
  if (part.condition !== "nominal") return true;
  const consumed = magnitudeOf15(serviceBudget(part)?.consumed);
  return consumed !== null && consumed >= SERVICE_ATTENTION;
}
function serviceClause(budget) {
  const used = magnitudeOf15(budget?.usedSeconds);
  const limit = magnitudeOf15(budget?.limitSeconds);
  if (used === null || limit === null) return void 0;
  const label = budget?.label ?? "service";
  if (used >= limit) {
    return /* @__PURE__ */ jsxs9(Fragment4, { children: [
      label,
      " overdue by ",
      /* @__PURE__ */ jsx9(Unit6, { value: seconds(used - limit) })
    ] });
  }
  return /* @__PURE__ */ jsxs9(Fragment4, { children: [
    label,
    " due in ",
    /* @__PURE__ */ jsx9(Unit6, { value: seconds(limit - used) })
  ] });
}
function joined(detail, rest) {
  if (detail && rest) {
    return /* @__PURE__ */ jsxs9(Fragment4, { children: [
      detail,
      " \xB7 ",
      rest
    ] });
  }
  return rest ?? detail;
}
function rowFor(part) {
  const detail = part.conditionDetail ?? void 0;
  if (part.condition === "failed-critical") {
    return { severity: "nogo", word: "critical failure", clause: detail };
  }
  if (part.condition === "failed") {
    return { severity: "nogo", word: "failed", clause: detail };
  }
  if (part.condition === "service-due") {
    const budget = serviceBudget(part);
    const consumed = magnitudeOf15(budget?.consumed);
    const overdue = consumed !== null && consumed >= 1 ? serviceClause(budget) : void 0;
    return {
      severity: "caution",
      word: "service due",
      clause: joined(detail, overdue)
    };
  }
  if (part.condition === "nominal") {
    return {
      severity: "caution",
      word: "service soon",
      clause: serviceClause(serviceBudget(part))
    };
  }
  return { severity: "offline", word: "unreadable", clause: detail };
}

// src/Reliability/index.tsx
import { jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
function stillTrue2(reading) {
  return reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
}
function KerbalismReliabilityUpdates({
  vesselId,
  compact
}) {
  const identity = stillTrue2(useTelemetry6("vessel.identity"));
  const summary = stillTrue2(useTelemetry6("kerbalism.reliability"));
  const partsReading = useTelemetry6("kerbalism.reliabilityParts");
  const crew = stillTrue2(useTelemetry6("vessel.crew"))?.crew ?? [];
  const stores = stillTrue2(useTelemetry6("vessel.inventory"))?.stores ?? [];
  if (!identity || identity.vesselId !== vesselId) return null;
  if (summary?.coverage !== "modeled") return null;
  const parts = stillTrue2(partsReading);
  if (parts === void 0) return null;
  const noteworthy = parts.filter(isNoteworthy);
  if (noteworthy.length === 0) return null;
  const held = partsReading.state === "held" ? partsReading.grade : null;
  const costOf = repairCostResolver(crew, stores);
  const rows = noteworthy.map((part) => ({ part, row: rowFor(part) }));
  const severity = worstSeverity(rows.map((entry) => entry.row.severity));
  const atRisk = rows.some(
    (entry) => entry.row.severity === "nogo" || entry.part.condition === "unknown"
  );
  return /* @__PURE__ */ jsxs10(Stack7, { role: "group", "aria-label": "Kerbalism reliability", children: [
    /* @__PURE__ */ jsxs10(Cluster8, { justify: "start", wrap: true, children: [
      /* @__PURE__ */ jsx10(Badge7, { tone: severity, children: `${rows.length} ${atRisk ? "at risk" : "to watch"}` }),
      held && /* @__PURE__ */ jsx10(Badge7, { tone: "caution", children: heldWord(held) })
    ] }),
    !compact && rows.map(({ part, row }, index) => (
      // The key falls back to the index, never the title: many modules share a title.
      /* @__PURE__ */ jsxs10(
        Card3,
        {
          tone: row.severity,
          title: part.title ?? "Unknown part",
          titleRight: /* @__PURE__ */ jsx10(Badge7, { tone: row.severity, children: row.word }),
          children: [
            row.clause !== void 0 && /* @__PURE__ */ jsx10(Text7, { level: "muted", children: row.clause }),
            !held && actionable(part.condition) && part.partId && /* @__PURE__ */ jsx10(
              RepairControl,
              {
                partId: part.partId,
                condition: part.condition,
                repairTrait: part.repairTrait,
                repairLevel: magnitudeOf16(part.repairLevel),
                crew,
                cost: costOf(part.repairCost)
              }
            )
          ]
        },
        part.partId ?? `idx-${index}`
      )
    ))
  ] });
}
registerAugment5({
  id: "kerbalism-reliability-updates",
  augments: "vessel-catalog.updates",
  component: KerbalismReliabilityUpdates,
  requires: "kerbalism",
  owner: KERBALISM
});
export {
  CREW_DEGENERATION_HORIZON_SECONDS,
  CREW_HISTORY,
  CREW_SURVIVAL,
  ISRU_CONVERTERS_TOPIC,
  ISRU_DRILLS_TOPIC,
  KERBALISM_AVAILABLE_TOPIC,
  KERBALISM_CREW_TOPIC,
  KERBALISM_FEATURES_TOPIC,
  KERBALISM_ISRU_PROVIDER_ID,
  KERBALISM_LIFESUPPORT_TOPIC,
  KERBALISM_PROFILE_TOPIC,
  KERBALISM_RELIABILITY_PARTS_TOPIC,
  KERBALISM_RELIABILITY_TOPIC,
  KERBALISM_SCIENCE_PROVIDER_ID,
  KERBALISM_SCIENCE_VALUE_MODEL,
  KERBALISM_SPACEWEATHER_TOPIC,
  KERBALISM_UNIT_SYMBOLS,
  RESOURCE_RATE_HORIZON_SECONDS,
  SCIENCE_EXPERIMENTS_TOPIC,
  SCIENCE_EXPERIMENT_BREAKDOWN_TOPIC,
  SCIENCE_INSTRUMENTS_TOPIC,
  SCIENCE_LAB_TOPIC,
  SHIP_SYSTEMS,
  GENERATED_COMMAND_IDS as UPLINK_COMMAND_IDS,
  buildGraph,
  buildLedger,
  closedLoops,
  diagnose,
  fitSlope,
  readKerbalismIsruConverterExt,
  readKerbalismIsruDrillExt,
  readKerbalismScienceBreakdownExt,
  readKerbalismScienceExperimentExt,
  readKerbalismScienceInstrumentExt,
  readKerbalismScienceLabExt,
  reckonCrewAccumulators,
  reckonResourceLevels,
  resourceBoundaryCrossings,
  resourceFacts,
  stronglyConnected,
  summarise,
  wearRows
};
