// src/lastValue.ts
function lastValue(reading) {
  return reading.state === "observed" || reading.state === "held" ? reading.value : void 0;
}

// src/topics.ts
import {
  registerUplinkTopic,
  registerEnumMembers,
  registerTopicUnits,
  registerTypeUnits
} from "@ksp-gonogo/sitrep-sdk";

// src/__generated__/units.ts
var GENERATED_TYPE_UNITS = {
  "CommsDataRate": {
    downBitsPerSec: "bit/s",
    upBitsPerSec: "bit/s"
  },
  "CommsLinkMargin": {
    closesLink: "flag",
    decibelMargin: "dB",
    quality: "ratio"
  },
  "RealAntennasAntennaArgs": {
    antennaId: "id"
  },
  "RealAntennasAntennaChain": {
    activeStep: "count",
    antennaId: "id",
    carrying: "flag",
    connected: "flag",
    detail: "text",
    laps: "count",
    lastAppliedUt: "ut",
    settleSeconds: "s",
    walkPhase: "text"
  },
  "RealAntennasAntennaState": {
    antennaId: "id",
    availableTargetModes: "text",
    beamwidth: "\xB0",
    cone10Db: "\xB0",
    cone3Db: "\xB0",
    gain: "dB",
    index: "count",
    minimumDistance: "m",
    name: "text",
    steerable: "flag",
    targetAltitude: "m",
    targetAzimuth: "\xB0",
    targetBodyName: "text",
    targetElevation: "\xB0",
    targetForward: "\xB0",
    targetKind: "text",
    targetLabel: "text",
    targetLatitude: "\xB0",
    targetLongitude: "\xB0",
    targetVesselId: "id",
    targeted: "flag",
    techLevel: "count"
  },
  "RealAntennasBorrowedDish": {
    dishId: "id",
    dishName: "text",
    peerId: "id",
    previousAim: "text",
    sinceUt: "ut"
  },
  "RealAntennasHopExt": {
    band: "text",
    beamwidth: "\xB0",
    codingRate: "ratio",
    encoder: "text",
    modulationBits: "count",
    powerDrawEc: "units/s",
    requiredEbN0: "dB",
    reverseBitsPerSec: "bit/s",
    techLevel: "count"
  },
  "RealAntennasHopRate": {
    bitsPerSec: "bit/s",
    fromNodeId: "id",
    toNodeId: "id"
  },
  "RealAntennasLastBorrow": {
    endedUt: "ut",
    outcome: "text",
    peerId: "id",
    turnedUt: "ut"
  },
  "RealAntennasSetAutoRetargetArgs": {
    allow: "flag",
    vessel: "id"
  },
  "RealAntennasTargetArgs": {
    altitude: "m",
    antennaId: "id",
    azimuth: "\xB0",
    bodyName: "text",
    elevation: "\xB0",
    forward: "\xB0",
    latitude: "\xB0",
    longitude: "\xB0",
    mode: "text",
    vesselId: "id"
  },
  "RealAntennasTargetChainArgs": {
    antennaId: "id",
    settleSeconds: "s"
  },
  "RealAntennasTargetStep": {
    altitude: "m",
    azimuth: "\xB0",
    bodyName: "text",
    elevation: "\xB0",
    forward: "\xB0",
    latitude: "\xB0",
    longitude: "\xB0",
    mode: "text",
    vesselId: "id"
  },
  "RealAntennasTargetStepArgs": {
    altitude: "m",
    azimuth: "\xB0",
    bodyName: "text",
    elevation: "\xB0",
    forward: "\xB0",
    latitude: "\xB0",
    longitude: "\xB0",
    mode: "text",
    vesselId: "id"
  },
  "RealAntennasVesselRetargeting": {
    allowed: "flag",
    vesselId: "id"
  }
};
var GENERATED_TOPIC_UNITS = {
  "comms.dataRate": {
    downBitsPerSec: "bit/s",
    upBitsPerSec: "bit/s"
  },
  "comms.linkMargin": {
    closesLink: "flag",
    decibelMargin: "dB",
    quality: "ratio"
  },
  "realantennas.antennaChains": {
    activeStep: "count",
    antennaId: "id",
    carrying: "flag",
    connected: "flag",
    detail: "text",
    laps: "count",
    lastAppliedUt: "ut",
    settleSeconds: "s",
    walkPhase: "text"
  },
  "realantennas.antennas": {
    antennaId: "id",
    availableTargetModes: "text",
    beamwidth: "\xB0",
    cone10Db: "\xB0",
    cone3Db: "\xB0",
    gain: "dB",
    index: "count",
    minimumDistance: "m",
    name: "text",
    steerable: "flag",
    targetAltitude: "m",
    targetAzimuth: "\xB0",
    targetBodyName: "text",
    targetElevation: "\xB0",
    targetForward: "\xB0",
    targetKind: "text",
    targetLabel: "text",
    targetLatitude: "\xB0",
    targetLongitude: "\xB0",
    targetVesselId: "id",
    targeted: "flag",
    techLevel: "count"
  },
  "realantennas.hopRates": {
    bitsPerSec: "bit/s",
    fromNodeId: "id",
    toNodeId: "id"
  },
  "realantennas.retargeting": {
    allowed: "flag",
    vesselId: "id"
  }
};
var GENERATED_TYPE_SHAPES = {
  "RealAntennasAntennaChain": {
    steps: "RealAntennasTargetStep[]"
  },
  "RealAntennasTargetChainArgs": {
    steps: "RealAntennasTargetStepArgs[]"
  },
  "RealAntennasVesselRetargeting": {
    borrowed: "RealAntennasBorrowedDish",
    last: "RealAntennasLastBorrow"
  }
};
var GENERATED_TOPIC_SHAPES = {
  "realantennas.antennaChains": {
    steps: "RealAntennasTargetStep[]"
  },
  "realantennas.retargeting": {
    borrowed: "RealAntennasBorrowedDish",
    last: "RealAntennasLastBorrow"
  }
};
var GENERATED_TYPE_ENUMS = {};
var GENERATED_TOPIC_ENUMS = {};
var GENERATED_TYPE_STATICS = {};
var GENERATED_TOPIC_STATICS = {};
var GENERATED_ENUM_MEMBERS = {};
var GENERATED_CONTRACT_TAGS = {
  topics: {},
  reckonable: []
};

// src/topics.ts
var REALANTENNAS_AVAILABLE_TOPIC = "realantennas.available";
var COMMS_DATA_RATE_TOPIC = "comms.dataRate";
var COMMS_LINK_MARGIN_TOPIC = "comms.linkMargin";
var REALANTENNAS_HOP_RATES_TOPIC = "realantennas.hopRates";
var REALANTENNAS_ANTENNAS_TOPIC = "realantennas.antennas";
var REALANTENNAS_CHAINS_TOPIC = "realantennas.antennaChains";
var REALANTENNAS_RETARGETING_TOPIC = "realantennas.retargeting";
registerUplinkTopic(REALANTENNAS_AVAILABLE_TOPIC);
registerUplinkTopic(COMMS_DATA_RATE_TOPIC);
registerUplinkTopic(COMMS_LINK_MARGIN_TOPIC);
registerUplinkTopic(REALANTENNAS_HOP_RATES_TOPIC);
registerUplinkTopic(REALANTENNAS_ANTENNAS_TOPIC);
registerUplinkTopic(REALANTENNAS_CHAINS_TOPIC);
registerUplinkTopic(REALANTENNAS_RETARGETING_TOPIC);
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

// src/uplink.ts
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";
var UPLINK_VERSION = "1.0.0-rc.2";
var REALANTENNAS = defineUplinkClient({
  id: "realantennas",
  version: UPLINK_VERSION,
  name: "RealAntennas",
  description: "Shows RealAntennas' radio links in the comms readouts when it is installed: band, data rate and link margin.",
  tags: GENERATED_CONTRACT_TAGS
});

// src/CommSignal/hopRates.ts
function computeRealAntennasHopRates(wire, held) {
  if (!wire) return [];
  const entries = [];
  for (const hop of wire) {
    const bits = hop.bitsPerSec?.magnitude;
    if (bits === void 0 || !Number.isFinite(bits)) continue;
    entries.push({
      fromNodeId: hop.fromNodeId,
      toNodeId: hop.toNodeId,
      bitsPerSec: bits,
      ...held === void 0 ? {} : { held }
    });
  }
  return entries;
}
REALANTENNAS.registerContribution({
  id: "comm-signal-hop-rates",
  contributes: "comm-signal.hop-rates",
  requires: "realantennas",
  deps: [REALANTENNAS_HOP_RATES_TOPIC],
  compute: (topics) => computeRealAntennasHopRates(
    lastValue(topics[REALANTENNAS_HOP_RATES_TOPIC]),
    topics[REALANTENNAS_HOP_RATES_TOPIC]
  )
});

// src/CommSignalRaAugment/index.tsx
import {
  registerAugment,
  useTelemetry
} from "@ksp-gonogo/sitrep-sdk";
import { Badge, Cluster, Grid, Stack, Text, Unit } from "@ksp-gonogo/ui-kit";

// src/hopExt.ts
import {
  PROVIDER_EXTENSIONS_FIELD,
  registerProviderExtensionShape
} from "@ksp-gonogo/sitrep-sdk";
var REALANTENNAS_PROVIDER_ID = "realantennas";
var COMMS_HOP_TYPE = "CommsHop";
var REALANTENNAS_HOP_EXT_TYPE = "RealAntennasHopExt";
registerProviderExtensionShape(
  COMMS_HOP_TYPE,
  REALANTENNAS_PROVIDER_ID,
  REALANTENNAS_HOP_EXT_TYPE
);
function readRealAntennasHopExt(hop) {
  const bag = hop?.[PROVIDER_EXTENSIONS_FIELD];
  if (bag === void 0 || bag === null) return void 0;
  const namespaced = bag[REALANTENNAS_PROVIDER_ID];
  if (namespaced === null || typeof namespaced !== "object") return void 0;
  return namespaced;
}

// src/CommSignalRaAugment/index.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function primaryHop(hops) {
  return hops && hops.length > 0 ? hops[0] : void 0;
}
var LABEL_STYLE = {
  letterSpacing: "0.1em",
  textTransform: "uppercase"
};
function CommSignalRaBadges() {
  const dataRate = useTelemetry("comms.dataRate");
  const path = useTelemetry("comms.path");
  const ext = readRealAntennasHopExt(
    primaryHop(path.state === "observed" ? path.value.hops : void 0)
  );
  const down = dataRate.state === "observed" ? dataRate.value.downBitsPerSec : void 0;
  if (down === void 0 && !ext?.band) return null;
  return (
    // `sm` (not `xs`): the band pill and the rate value are two distinct
    // readings, not one run-on label, and `xs`'s 2px gap read as the rate
    // crowding the pill's rounded edge rather than sitting beside it.
    /* @__PURE__ */ jsxs(Cluster, { gap: "related-dense", align: "center", children: [
      ext?.band ? /* @__PURE__ */ jsxs(Badge, { tone: "info", children: [
        ext.band,
        "-band"
      ] }) : null,
      down !== void 0 ? /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", children: /* @__PURE__ */ jsx(Unit, { value: down }) }) : null
    ] })
  );
}
function CommSignalRaSection() {
  const marginReading = useTelemetry("comms.linkMargin");
  const path = useTelemetry("comms.path");
  const margin = marginReading.state === "observed" ? marginReading.value : void 0;
  const ext = readRealAntennasHopExt(
    primaryHop(path.state === "observed" ? path.value.hops : void 0)
  );
  const hasMargin = margin?.decibelMargin !== void 0;
  const hasExt = ext !== void 0 && (ext.techLevel != null || ext.modulationBits != null || !!ext.encoder || ext.requiredEbN0 != null || ext.beamwidth != null || ext.reverseBitsPerSec != null);
  if (!hasMargin && !hasExt) return null;
  return (
    // Labelled "LINK BUDGET", not "RealAntennas": the operator gets the link
    // data this section presents, not which mod computed it.
    /* @__PURE__ */ jsxs(Stack, { gap: "caption", "aria-label": "Link budget detail", children: [
      /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Link budget" }),
      /* @__PURE__ */ jsxs(
        Grid,
        {
          cols: "auto 1fr",
          gap: "label-value",
          rowGap: "readout-row",
          align: "baseline",
          children: [
            hasMargin ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Margin" }),
              /* @__PURE__ */ jsxs(Text, { size: "sm", tone: margin?.closesLink ? "go" : "nogo", children: [
                /* @__PURE__ */ jsx(Unit, { value: margin?.decibelMargin }),
                margin?.closesLink === false ? " (open)" : null
              ] })
            ] }) : null,
            ext?.encoder ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Encoder" }),
              /* @__PURE__ */ jsx(Text, { size: "sm", children: ext.encoder })
            ] }) : null,
            ext?.modulationBits != null ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Modulation" }),
              /* @__PURE__ */ jsx(Text, { size: "sm", children: /* @__PURE__ */ jsx(Unit, { value: ext.modulationBits }) })
            ] }) : null,
            ext?.techLevel != null ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Tech level" }),
              /* @__PURE__ */ jsx(Text, { size: "sm", children: /* @__PURE__ */ jsx(Unit, { value: ext.techLevel }) })
            ] }) : null,
            ext?.requiredEbN0 != null ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Req Eb/N0" }),
              /* @__PURE__ */ jsx(Text, { size: "sm", children: /* @__PURE__ */ jsx(Unit, { value: ext.requiredEbN0 }) })
            ] }) : null,
            ext?.reverseBitsPerSec != null ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Text, { size: "xs", level: "muted", style: LABEL_STYLE, children: "Uplink rate" }),
              /* @__PURE__ */ jsx(Text, { size: "sm", children: /* @__PURE__ */ jsx(Unit, { value: ext.reverseBitsPerSec }) })
            ] }) : null
          ]
        }
      )
    ] })
  );
}
registerAugment({
  id: "realantennas-comm-signal-badge",
  augments: "comm-signal.badges",
  requires: "realantennas",
  channels: ["comms.dataRate", "comms.path"],
  component: CommSignalRaBadges,
  owner: REALANTENNAS
});
registerAugment({
  id: "realantennas-comm-signal-section",
  augments: "comm-signal.sections",
  requires: "realantennas",
  channels: ["comms.linkMargin", "comms.path"],
  component: CommSignalRaSection,
  owner: REALANTENNAS
});

// src/commands.ts
import { registerUplinkCommand } from "@ksp-gonogo/sitrep-sdk";

// src/__generated__/command-map.ts
var GENERATED_COMMAND_RAIL = {
  "realantennas.antenna.target": { replies: true, delayed: true },
  "realantennas.antenna.targetChain": { replies: true, delayed: true },
  "realantennas.antenna.targetHome": { replies: true, delayed: true },
  "realantennas.vessel.setAutoRetarget": { replies: true, delayed: true }
};
var GENERATED_COMMAND_IDS = [
  "realantennas.antenna.target",
  "realantennas.antenna.targetChain",
  "realantennas.antenna.targetHome",
  "realantennas.vessel.setAutoRetarget"
];

// src/commands.ts
for (const id of GENERATED_COMMAND_IDS) {
  registerUplinkCommand(id, GENERATED_COMMAND_RAIL[id]);
}

// src/CommSignalAntennaTargets/index.tsx
import {
  registerAugment as registerAugment2,
  useCommand as useCommand3,
  useTelemetry as useTelemetry2
} from "@ksp-gonogo/sitrep-sdk";
import {
  Card as Card2,
  Cluster as Cluster4,
  CommandButton as CommandButton2,
  Field,
  FieldLabel,
  Grid as Grid2,
  Input,
  magnitudeOf as magnitudeOf2,
  SectionTitle as SectionTitle2,
  Select,
  Stack as Stack4,
  SubjectHeading,
  Text as Text4,
  Unit as Unit4
} from "@ksp-gonogo/ui-kit";
import { useCallback, useId, useState } from "react";

// src/CommSignalAntennaTargets/chain.tsx
import { useCommand, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge as Badge2,
  Button,
  Cluster as Cluster2,
  CommandButton,
  magnitudeOf,
  magnitudeOr,
  Stack as Stack2,
  Text as Text2,
  Unit as Unit2
} from "@ksp-gonogo/ui-kit";
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var LABEL_STYLE2 = {
  letterSpacing: "0.1em",
  textTransform: "uppercase"
};
var MODE_LABELS = {
  BodyCenter: "Body centre",
  Vessel: "Vessel",
  BodyLatLonAlt: "Surface point",
  AzEl: "Azimuth / elevation",
  OrbitRelative: "Orbit relative"
};
var STATE_SEVERITY = {
  holding: "go",
  settling: "info",
  walking: "warn",
  blocked: "caution"
};
var STATE_LABELS = {
  holding: "Holding",
  settling: "Settling",
  walking: "Walking",
  blocked: "Blocked"
};
function StepLabel({ step }) {
  const mode = MODE_LABELS[step.mode] ?? step.mode;
  if (step.mode === "Vessel") {
    return /* @__PURE__ */ jsxs2(Fragment2, { children: [
      mode,
      step.vesselId ? ` \xB7 ${step.vesselId}` : ""
    ] });
  }
  if (step.mode === "BodyCenter") {
    return /* @__PURE__ */ jsx2(Fragment2, { children: `${mode} \xB7 ${step.bodyName || "home"}` });
  }
  if (step.mode === "BodyLatLonAlt") {
    return /* @__PURE__ */ jsxs2(Fragment2, { children: [
      `${mode} \xB7 ${step.bodyName || "home"} `,
      /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.latitude) }),
      " / ",
      /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.longitude) }),
      step.altitude != null ? /* @__PURE__ */ jsxs2(Fragment2, { children: [
        " \xB7 ",
        /* @__PURE__ */ jsx2(Unit2, { value: metres(step.altitude) })
      ] }) : null
    ] });
  }
  if (step.mode === "AzEl") {
    return /* @__PURE__ */ jsxs2(Fragment2, { children: [
      `${mode} \xB7 `,
      /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.azimuth) }),
      " / ",
      /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.elevation) })
    ] });
  }
  return /* @__PURE__ */ jsxs2(Fragment2, { children: [
    `${mode} \xB7 `,
    /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.forward) }),
    " / ",
    /* @__PURE__ */ jsx2(Unit2, { value: degrees(step.elevation) })
  ] });
}
function degrees(quantity) {
  const magnitude = magnitudeOf(quantity);
  return magnitude === null ? void 0 : value("\xB0", magnitude);
}
function metres(quantity) {
  const magnitude = magnitudeOf(quantity);
  return magnitude === null ? void 0 : value("m", magnitude);
}
function positioned(steps) {
  return steps.map((step, position) => ({ position, step }));
}
function AntennaChain({
  antennaId,
  antennaName,
  chain,
  draft,
  onStage,
  onUnstage,
  onSent
}) {
  const setChain = useCommand("realantennas.antenna.targetChain");
  const activeStep = magnitudeOf(chain?.activeStep);
  const laps = magnitudeOr(chain?.laps, 0);
  return /* @__PURE__ */ jsxs2(Stack2, { gap: "related-dense", children: [
    /* @__PURE__ */ jsxs2(Cluster2, { gap: "related-comfortable", wrap: true, align: "center", children: [
      /* @__PURE__ */ jsx2(Text2, { size: "xs", level: "muted", style: LABEL_STYLE2, children: "Fallback chain" }),
      chain ? /* @__PURE__ */ jsx2(Badge2, { tone: STATE_SEVERITY[chain.walkPhase] ?? "info", size: "sm", children: STATE_LABELS[chain.walkPhase] ?? chain.walkPhase }) : /* @__PURE__ */ jsx2(Text2, { size: "xs", level: "muted", children: "None set" }),
      laps > 0 ? /* @__PURE__ */ jsx2(Text2, { size: "xs", level: "muted", children: `${laps} full ${laps === 1 ? "pass" : "passes"} with no link` }) : null
    ] }),
    chain?.detail ? /* @__PURE__ */ jsx2(Text2, { size: "xs", level: "muted", children: chain.detail }) : null,
    chain ? /* @__PURE__ */ jsx2("ol", { "aria-label": `Fallback chain for ${antennaName}`, children: positioned(chain.steps).map(({ position, step }) => {
      const aimedHere = position === activeStep;
      return /* @__PURE__ */ jsx2("li", { children: /* @__PURE__ */ jsxs2(Text2, { size: "sm", level: aimedHere ? void 0 : "muted", children: [
        /* @__PURE__ */ jsx2(StepLabel, { step }),
        aimedHere ? " \xB7 aimed here now" : ""
      ] }) }, position);
    }) }) : null,
    chain ? /* @__PURE__ */ jsxs2(Text2, { size: "xs", level: "muted", children: [
      "Each target is given ",
      /* @__PURE__ */ jsx2(Unit2, { value: chain.settleSeconds }),
      " to produce a link before the craft tries the next."
    ] }) : null,
    draft.length > 0 ? /* @__PURE__ */ jsx2("ol", { "aria-label": `Chain being composed for ${antennaName}`, children: positioned(draft).map(({ position, step }) => /* @__PURE__ */ jsx2("li", { children: /* @__PURE__ */ jsx2(Text2, { size: "sm", children: /* @__PURE__ */ jsx2(StepLabel, { step }) }) }, position)) }) : null,
    /* @__PURE__ */ jsxs2(Cluster2, { gap: "related-comfortable", wrap: true, justify: "start", children: [
      /* @__PURE__ */ jsx2(Button, { variant: "ghost", type: "button", onClick: onStage, children: "ADD TARGET ABOVE" }),
      draft.length > 0 ? /* @__PURE__ */ jsx2(Button, { variant: "ghost", type: "button", onClick: onUnstage, children: "REMOVE LAST" }) : null,
      draft.length > 0 ? /* @__PURE__ */ jsx2(
        CommandButton,
        {
          size: "sm",
          handle: setChain,
          args: { antennaId, steps: [...draft] },
          commandLabel: `Set the fallback chain for ${antennaName}`,
          label: "SET CHAIN",
          confirmLabel: "CONFIRM CHAIN",
          pendingLabel: "Sending...",
          onConfirmed: onSent
        }
      ) : null,
      chain ? /* @__PURE__ */ jsx2(
        CommandButton,
        {
          size: "sm",
          handle: setChain,
          args: { antennaId, steps: [] },
          commandLabel: `Clear the fallback chain for ${antennaName}`,
          label: "CLEAR CHAIN",
          confirmLabel: "CONFIRM CLEAR",
          pendingLabel: "Clearing..."
        }
      ) : null
    ] })
  ] });
}

// src/CommSignalAntennaTargets/retargeting.tsx
import { useCommand as useCommand2, value as value2 } from "@ksp-gonogo/sitrep-sdk";
import {
  Card,
  Cluster as Cluster3,
  SectionTitle,
  Stack as Stack3,
  Switch,
  Text as Text3,
  Unit as Unit3
} from "@ksp-gonogo/ui-kit";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function guidOf(nodeId) {
  return nodeId.startsWith("vessel:") ? nodeId.slice("vessel:".length) : nodeId;
}
function nameOf(nodeId, vessels) {
  if (nodeId.startsWith("ground:")) return nodeId.slice("ground:".length);
  const guid = guidOf(nodeId);
  return vessels.find((v) => v.id === guid)?.name ?? guid;
}
var LABEL_STYLE3 = {
  letterSpacing: "0.1em",
  textTransform: "uppercase"
};
function RetargetSwitch({ vesselId, name, entry }) {
  const setAutoRetarget = useCommand2("realantennas.vessel.setAutoRetarget");
  const allowed = entry?.allowed ?? true;
  return /* @__PURE__ */ jsx3(Cluster3, { gap: "related-comfortable", align: "center", wrap: true, justify: "start", children: /* @__PURE__ */ jsx3(
    Switch,
    {
      checked: allowed,
      label: `Automatic retargeting, ${name}`,
      onChange: (next) => {
        void setAutoRetarget.send({ vessel: vesselId, allow: next }).catch(() => void 0);
      }
    }
  ) });
}
function BorrowedNotice({ entry, vessels }) {
  const borrowed = entry.borrowed;
  if (!borrowed) return null;
  return /* @__PURE__ */ jsxs3(Text3, { size: "sm", role: "status", children: [
    "Borrowed \xB7 ",
    borrowed.dishName || "a dish",
    " aimed at",
    " ",
    nameOf(borrowed.peerId, vessels),
    " since",
    " ",
    /* @__PURE__ */ jsx3(Unit3, { value: borrowed.sinceUt }),
    " \xB7 turns back to ",
    borrowed.previousAim
  ] });
}
function LastNotice({ entry, vessels }) {
  const last = entry.last;
  if (!last || entry.borrowed) return null;
  const outcome = last.outcome === "restored" ? "put back" : last.outcome === "taken" ? "taken over by the operator" : "gone";
  return /* @__PURE__ */ jsxs3(Text3, { size: "xs", level: "muted", children: [
    "Last borrowed for ",
    nameOf(last.peerId, vessels),
    ", ",
    outcome,
    ", for",
    " ",
    /* @__PURE__ */ jsx3(
      Unit3,
      {
        value: value2(
          "s",
          Math.max(0, last.endedUt.valueOf() - last.turnedUt.valueOf())
        )
      }
    )
  ] });
}
function Retargeting({ vesselId, entries, vessels }) {
  const own = entries.find((e) => e.vesselId === vesselId);
  const others = entries.filter(
    (e) => e.vesselId !== vesselId && (!e.allowed || e.borrowed)
  );
  return /* @__PURE__ */ jsxs3(Stack3, { gap: "related-dense", "aria-label": "Dish turning", children: [
    /* @__PURE__ */ jsx3(SectionTitle, { children: "Dish turning" }),
    /* @__PURE__ */ jsx3(Card, { children: /* @__PURE__ */ jsxs3(Stack3, { gap: "related-dense", children: [
      /* @__PURE__ */ jsx3(Text3, { size: "xs", level: "muted", style: LABEL_STYLE3, children: "This craft" }),
      /* @__PURE__ */ jsx3(
        RetargetSwitch,
        {
          vesselId,
          name: nameOf(`vessel:${vesselId}`, vessels),
          entry: own
        }
      ),
      own ? /* @__PURE__ */ jsx3(BorrowedNotice, { entry: own, vessels }) : null,
      own ? /* @__PURE__ */ jsx3(LastNotice, { entry: own, vessels }) : null
    ] }) }),
    others.map((entry) => /* @__PURE__ */ jsx3(Card, { children: /* @__PURE__ */ jsxs3(Stack3, { gap: "related-dense", children: [
      /* @__PURE__ */ jsx3(Text3, { size: "xs", level: "muted", style: LABEL_STYLE3, children: nameOf(`vessel:${entry.vesselId}`, vessels) }),
      /* @__PURE__ */ jsx3(
        RetargetSwitch,
        {
          vesselId: entry.vesselId,
          name: nameOf(`vessel:${entry.vesselId}`, vessels),
          entry
        }
      ),
      /* @__PURE__ */ jsx3(BorrowedNotice, { entry, vessels })
    ] }) }, entry.vesselId))
  ] });
}

// src/CommSignalAntennaTargets/index.tsx
import { Fragment as Fragment3, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var MODES = [
  { id: "BodyCenter", label: "Body centre" },
  { id: "Vessel", label: "Vessel" },
  { id: "BodyLatLonAlt", label: "Surface point" },
  { id: "AzEl", label: "Azimuth / elevation" },
  { id: "OrbitRelative", label: "Orbit relative" }
];
var LABEL_STYLE4 = {
  letterSpacing: "0.1em",
  textTransform: "uppercase"
};
function numberOf(text) {
  if (text.trim() === "") return void 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function AntennaCard({ antenna, chain, bodies, vessels }) {
  const fieldId = useId();
  const [mode, setMode] = useState("BodyCenter");
  const [bodyName, setBodyName] = useState("");
  const [vesselId, setVesselId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [altitude, setAltitude] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [elevation, setElevation] = useState("");
  const [forward, setForward] = useState("");
  const target = useCommand3("realantennas.antenna.target");
  const targetHome = useCommand3("realantennas.antenna.targetHome");
  const [draft, setDraft] = useState([]);
  const composed = () => ({
    mode,
    vesselId: vesselId || void 0,
    bodyName: bodyName || void 0,
    latitude: numberOf(latitude),
    longitude: numberOf(longitude),
    altitude: numberOf(altitude),
    azimuth: numberOf(azimuth),
    elevation: numberOf(elevation),
    forward: numberOf(forward)
  });
  const stage = () => setDraft((entries) => [...entries, composed()]);
  const unstage = () => setDraft((entries) => entries.slice(0, -1));
  const clearDraft = useCallback(() => setDraft([]), []);
  const unlocked = antenna.availableTargetModes ?? [];
  const modeIsUnlocked = (id) => unlocked.includes(id);
  const antennaName = antenna.name ?? antenna.antennaId;
  const isOmni = antenna.steerable === false;
  const steerableUnread = antenna.steerable == null;
  return /* @__PURE__ */ jsx4(Card2, { children: /* @__PURE__ */ jsxs4(Stack4, { gap: "related-dense", children: [
    /* @__PURE__ */ jsx4(
      SubjectHeading,
      {
        status: isOmni ? /* @__PURE__ */ jsx4(Text4, { size: "xs", level: "muted", style: LABEL_STYLE4, children: "Omni" }) : null,
        children: /* @__PURE__ */ jsx4(Text4, { size: "sm", children: antennaName })
      }
    ),
    /* @__PURE__ */ jsxs4(
      Grid2,
      {
        cols: "auto 1fr",
        gap: "section-compact",
        rowGap: "related-dense",
        align: "baseline",
        children: [
          antenna.techLevel != null ? /* @__PURE__ */ jsxs4(Fragment3, { children: [
            /* @__PURE__ */ jsx4(Text4, { size: "xs", level: "muted", style: LABEL_STYLE4, children: "Tech level" }),
            /* @__PURE__ */ jsx4(Text4, { size: "sm", children: /* @__PURE__ */ jsx4(Unit4, { value: antenna.techLevel }) })
          ] }) : null,
          !isOmni ? /* @__PURE__ */ jsxs4(Fragment3, { children: [
            /* @__PURE__ */ jsx4(Text4, { size: "xs", level: "muted", style: LABEL_STYLE4, children: "Aimed at" }),
            /* @__PURE__ */ jsx4(
              Text4,
              {
                size: "sm",
                level: antenna.targeted === true ? void 0 : "muted",
                children: antenna.targeted === true ? antenna.targetLabel : antenna.targeted === false ? "Not aimed" : "Could not be read"
              }
            )
          ] }) : null,
          !isOmni && magnitudeOf2(antenna.cone10Db) !== null ? /* @__PURE__ */ jsxs4(Fragment3, { children: [
            /* @__PURE__ */ jsx4(Text4, { size: "xs", level: "muted", style: LABEL_STYLE4, children: "Beam" }),
            /* @__PURE__ */ jsx4(Text4, { size: "sm", children: /* @__PURE__ */ jsx4(Unit4, { value: antenna.cone10Db }) })
          ] }) : null
        ]
      }
    ),
    steerableUnread ? (
      /*
        No controls, and a line saying why there are none. The mod refuses
        both commands for this antenna on the same grounds, so a live AIM
        button would be a press that provably goes nowhere; an inert-looking
        card beside a stated reason is honest where a live-looking one that
        swallows the press is not.
      */
      /* @__PURE__ */ jsx4(Text4, { size: "xs", level: "muted", children: "RealAntennas would not say whether this antenna can be aimed, so the targeting controls are held." })
    ) : null,
    antenna.steerable === true ? (
      /*
        Two groups, not one run: the fields sit tight to each other and the
        actions a step further out. A press that lands as close to the last
        field as the fields do to one another reads as another field.
      */
      /* @__PURE__ */ jsxs4(Stack4, { gap: "section-compact", children: [
        /* @__PURE__ */ jsxs4(Stack4, { gap: "related-dense", children: [
          /* @__PURE__ */ jsxs4(Field, { children: [
            /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-mode`, children: "Mode" }),
            /* @__PURE__ */ jsx4(
              Select,
              {
                id: `${fieldId}-mode`,
                value: mode,
                onChange: (e) => setMode(e.target.value),
                children: MODES.map((m) => /* @__PURE__ */ jsx4(
                  "option",
                  {
                    value: m.id,
                    disabled: !modeIsUnlocked(m.id),
                    children: modeIsUnlocked(m.id) ? m.label : `${m.label} (locked)`
                  },
                  m.id
                ))
              }
            )
          ] }),
          mode === "Vessel" ? /* @__PURE__ */ jsxs4(Field, { children: [
            /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-vessel`, children: "Vessel" }),
            /* @__PURE__ */ jsxs4(
              Select,
              {
                id: `${fieldId}-vessel`,
                value: vesselId,
                onChange: (e) => setVesselId(e.target.value),
                children: [
                  /* @__PURE__ */ jsx4("option", { value: "", children: "Choose a target" }),
                  vessels.map((v) => /* @__PURE__ */ jsx4("option", { value: v.id, children: v.name }, v.id))
                ]
              }
            )
          ] }) : null,
          mode === "BodyCenter" || mode === "BodyLatLonAlt" ? /* @__PURE__ */ jsxs4(Field, { children: [
            /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-body`, children: "Body" }),
            /* @__PURE__ */ jsxs4(
              Select,
              {
                id: `${fieldId}-body`,
                value: bodyName,
                onChange: (e) => setBodyName(e.target.value),
                children: [
                  /* @__PURE__ */ jsx4("option", { value: "", children: "Home" }),
                  bodies.map((b) => /* @__PURE__ */ jsx4("option", { value: b, children: b }, b))
                ]
              }
            )
          ] }) : null,
          mode === "BodyLatLonAlt" ? /* @__PURE__ */ jsxs4(Cluster4, { gap: "related-comfortable", wrap: true, children: [
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-lat`, children: "Lat \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-lat`,
                  inputMode: "decimal",
                  value: latitude,
                  onChange: (e) => setLatitude(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-lon`, children: "Lon \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-lon`,
                  inputMode: "decimal",
                  value: longitude,
                  onChange: (e) => setLongitude(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-alt`, children: "Alt m" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-alt`,
                  inputMode: "decimal",
                  value: altitude,
                  onChange: (e) => setAltitude(e.target.value)
                }
              )
            ] })
          ] }) : null,
          mode === "AzEl" ? /* @__PURE__ */ jsxs4(Cluster4, { gap: "related-comfortable", wrap: true, children: [
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-az`, children: "Az \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-az`,
                  inputMode: "decimal",
                  value: azimuth,
                  onChange: (e) => setAzimuth(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-el`, children: "El \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-el`,
                  inputMode: "decimal",
                  value: elevation,
                  onChange: (e) => setElevation(e.target.value)
                }
              )
            ] })
          ] }) : null,
          mode === "OrbitRelative" ? /* @__PURE__ */ jsxs4(Cluster4, { gap: "related-comfortable", wrap: true, children: [
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-fwd`, children: "Prograde \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-fwd`,
                  inputMode: "decimal",
                  value: forward,
                  onChange: (e) => setForward(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs4(Field, { children: [
              /* @__PURE__ */ jsx4(FieldLabel, { htmlFor: `${fieldId}-oel`, children: "El \xB0" }),
              /* @__PURE__ */ jsx4(
                Input,
                {
                  id: `${fieldId}-oel`,
                  inputMode: "decimal",
                  value: elevation,
                  onChange: (e) => setElevation(e.target.value)
                }
              )
            ] })
          ] }) : null
        ] }),
        /* @__PURE__ */ jsxs4(Cluster4, { gap: "related-comfortable", wrap: true, justify: "start", children: [
          /* @__PURE__ */ jsx4(
            CommandButton2,
            {
              size: "sm",
              handle: target,
              args: {
                antennaId: antenna.antennaId,
                mode,
                vesselId: vesselId || void 0,
                bodyName: bodyName || void 0,
                latitude: numberOf(latitude),
                longitude: numberOf(longitude),
                altitude: numberOf(altitude),
                azimuth: numberOf(azimuth),
                elevation: numberOf(elevation),
                forward: numberOf(forward)
              },
              commandLabel: `Aim ${antennaName}`,
              label: "AIM",
              confirmLabel: "CONFIRM AIM",
              pendingLabel: "Aiming..."
            }
          ),
          /* @__PURE__ */ jsx4(
            CommandButton2,
            {
              size: "sm",
              handle: targetHome,
              args: { antennaId: antenna.antennaId },
              commandLabel: `Aim ${antennaName} at the home body`,
              label: "HOME",
              confirmLabel: "CONFIRM HOME",
              pendingLabel: "Aiming..."
            }
          )
        ] }),
        /* @__PURE__ */ jsx4(
          AntennaChain,
          {
            antennaId: antenna.antennaId,
            antennaName,
            chain,
            draft,
            onStage: stage,
            onUnstage: unstage,
            onSent: clearDraft
          }
        )
      ] })
    ) : null
  ] }) });
}
function CommSignalAntennaTargets() {
  const antennasReading = useTelemetry2("realantennas.antennas");
  const chainsReading = useTelemetry2("realantennas.antennaChains");
  const retargetingReading = useTelemetry2("realantennas.retargeting");
  const bodiesReading = useTelemetry2("trackingStation.bodies");
  const vesselsReading = useTelemetry2("trackingStation.catalog");
  const antennas = antennasReading.state === "observed" ? antennasReading.value : void 0;
  if (!antennas || antennas.length === 0) return null;
  const chains = new Map(
    (chainsReading.state === "observed" ? chainsReading.value : []).map(
      (chain) => [chain.antennaId, chain]
    )
  );
  const bodies = bodiesReading.state === "observed" ? bodiesReading.value.bodies.map((b) => b.name).filter((n) => !!n) : [];
  const vessels = vesselsReading.state === "observed" ? vesselsReading.value.entries.map((v) => ({
    id: v.vesselId,
    name: v.name || v.vesselId
  })) : [];
  const source = antennas[0]?.meta?.source ?? "";
  const reportedVessel = source.startsWith("vessel:") ? source.slice("vessel:".length) : "";
  return /* @__PURE__ */ jsxs4(Stack4, { gap: "related-dense", "aria-label": "Antenna targeting", children: [
    /* @__PURE__ */ jsx4(SectionTitle2, { children: "Antenna targeting" }),
    antennas.map((antenna) => /* @__PURE__ */ jsx4(
      AntennaCard,
      {
        antenna,
        chain: chains.get(antenna.antennaId),
        bodies,
        vessels
      },
      antenna.antennaId
    )),
    reportedVessel ? /* @__PURE__ */ jsx4(
      Retargeting,
      {
        vesselId: reportedVessel,
        entries: retargetingReading.state === "observed" ? retargetingReading.value : [],
        vessels
      }
    ) : null
  ] });
}
registerAugment2({
  id: "realantennas-comm-signal-antenna-targets",
  augments: "comm-signal.sections",
  requires: "realantennas",
  channels: [
    "realantennas.antennas",
    "realantennas.antennaChains",
    "realantennas.retargeting",
    "trackingStation.bodies",
    "trackingStation.catalog"
  ],
  component: CommSignalAntennaTargets,
  owner: REALANTENNAS
});
export {
  COMMS_DATA_RATE_TOPIC,
  COMMS_LINK_MARGIN_TOPIC,
  CommSignalRaBadges,
  CommSignalRaSection,
  REALANTENNAS_ANTENNAS_TOPIC,
  REALANTENNAS_AVAILABLE_TOPIC,
  REALANTENNAS_CHAINS_TOPIC,
  REALANTENNAS_HOP_RATES_TOPIC,
  REALANTENNAS_RETARGETING_TOPIC,
  GENERATED_COMMAND_IDS as UPLINK_COMMAND_IDS,
  computeRealAntennasHopRates,
  readRealAntennasHopExt
};
