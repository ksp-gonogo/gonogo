import type {
  ComponentProps,
  Reading,
  TopicReading,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  combineReadings,
  DeployedPowerState,
  registerComponent,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  Cluster,
  EmptyState,
  Panel,
  Section,
  Stack,
  StatusIndicator,
  type StatusTone,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { BREAKING_GROUND } from "../uplink";
import { boolOrNull, num, numOrNull } from "../wire";

/**
 * Deployed Base Monitor (Breaking Ground). Lists every deployed surface
 * science base on every body (loaded or not), with its power balance and
 * per-experiment science progress toward cap. Read-only: deployed science
 * auto-transmits and background bases can't be actioned remotely.
 *
 * Reads `deployed.bases` + `deployed.available`; degrades to a muted empty
 * state without Breaking Ground or when no base is deployed.
 *
 * `deployed.bases` comes off `BreakingGroundViewProvider.BuildDeployed`, itself fed by
 * `Gonogo.KSP.KspHost.BuildDeployedScience`'s GLOBAL `FlightGlobals.Vessels`
 * walk, because a Breaking Ground cluster is its own vessel and never the active
 * one. `parseBases` below accepts both wire shapes; see its own doc comment for
 * the field-by-field mapping.
 *
 * `deployed.available` reads `game.dlc.breakingGround`, an independent
 * capability boolean rather than something derived from `deployed.bases` being
 * empty.
 *
 * The fixtures behind this are hand-authored to the real wire shape rather than
 * captured, because a capture needs a deployed cluster in physics range.
 */

type DeployedScienceConfig = Record<string, never>;

/**
 * One deployed experiment as the widget draws it.
 *
 * The science figures are `number | null` for the same reason the power balance
 * below is: the mod withholds each of them through `SnapshotDict.GetDouble`, and
 * a deployed experiment genuinely sitting at 0% is a reading. A substituted zero
 * drew the card at "0%" with an empty bar AND lit the collecting dot, because
 * `collecting` was derived as `pct < 100` and 0 satisfies it, so an experiment
 * nobody read presented as one that has gathered nothing and is hard at work.
 * `aria-valuenow=0` said it to a screen reader too.
 *
 * `collecting` is therefore `boolean | null` as well: a verdict derived from a
 * fabricated number is the same lie one layer up.
 */
export interface DeployedExperiment {
  partId: number;
  id: string;
  name: string;
  total: number | null;
  limit: number | null;
  progress: number | null;
  stored: number | null;
  transmitted: number | null;
  collecting: boolean | null;
}

export interface DeployedBase {
  id: number;
  body: string;
  /** `null` when the mod declined to state the cluster's power state, which is
   *  a third answer and not "unpowered": `power === DeployedPowerState.Powered`
   *  made every unread base paint a red "Unpowered" pill. */
  powered: boolean | null;
  partialPower: boolean;
  /** Breaking Ground's own integral power units, not electric charge. `null`
   *  when the cluster could not be read: a live cluster with dark panels
   *  genuinely reports 0, so a zero cannot stand in for absence. */
  powerAvailable: number | null;
  powerRequired: number | null;
  controllerEnabled: boolean;
  experimentCount: number;
  experiments: DeployedExperiment[];
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: TopicReading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp01OrNull = (v: number | null) => (v === null ? null : clamp01(v));

function parseExperiments(raw: unknown): DeployedExperiment[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: DeployedExperiment[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      // A React list key, never rendered as text, so a substitute here states
      // nothing about the craft. Every field below it does.
      partId: num(e.partId, 0),
      id: typeof e.id === "string" ? e.id : "",
      name: typeof e.name === "string" && e.name ? e.name : "Experiment",
      total: numOrNull(e.total),
      limit: numOrNull(e.limit),
      progress: clamp01OrNull(numOrNull(e.progress)),
      stored: numOrNull(e.stored),
      transmitted: numOrNull(e.transmitted),
      collecting: typeof e.collecting === "boolean" ? e.collecting : null,
    });
  }
  return out;
}

/** One flat entry off the new `deployed.bases` wire; see `parseBases`'s doc comment. */
interface FlatDeployedEntry {
  vesselName: string;
  partName: string | null;
  body: string | null;
  experimentId: string | null;
  /** The four science figures, `null` when the mod withheld one. Zero is a
   *  reading here: a freshly planted experiment reports 0%. See
   *  {@link DeployedExperiment}. */
  scienceCompletedPercentage: number | null;
  scienceTransmittedPercentage: number | null;
  scienceValue: number | null;
  scienceLimit: number | null;
  /** Localised prose, display only. {@link power} is the field to branch on. */
  powerState: string | null;
  /** Localised prose, display only. See {@link controllerConnected}. */
  connectionState: string | null;
  /** The mod's derived power state. Null when it could not be determined, which
   *  is a third answer and not "unpowered". */
  power: DeployedPowerState | null;
  /** The mod's derived controller-attachment fact. */
  controllerConnected: boolean | null;
  /** The cluster's power balance in Breaking Ground's own power units. Null
   *  when the cluster could not be read; see {@link DeployedBase.powerAvailable}. */
  powerAvailable: number | null;
  powerRequired: number | null;
}

function parseFlatDeployedEntry(entry: unknown): FlatDeployedEntry | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.vesselName !== "string" || !e.vesselName) return null;
  return {
    vesselName: e.vesselName,
    partName: typeof e.partName === "string" ? e.partName : null,
    body: typeof e.body === "string" ? e.body : null,
    experimentId: typeof e.experimentId === "string" ? e.experimentId : null,
    scienceCompletedPercentage: numOrNull(e.scienceCompletedPercentage),
    scienceTransmittedPercentage: numOrNull(e.scienceTransmittedPercentage),
    scienceValue: numOrNull(e.scienceValue),
    scienceLimit: numOrNull(e.scienceLimit),
    powerState: typeof e.powerState === "string" ? e.powerState : null,
    connectionState:
      typeof e.connectionState === "string" ? e.connectionState : null,
    power: typeof e.power === "number" ? (e.power as DeployedPowerState) : null,
    controllerConnected:
      typeof e.controllerConnected === "boolean" ? e.controllerConnected : null,
    powerAvailable: numOrNull(e.powerAvailable),
    powerRequired: numOrNull(e.powerRequired),
  };
}

/**
 * The mod's derived `DeployedPowerState` -> this widget's
 * `powered`/`partialPower` pair.
 *
 * This read `ModuleGroundSciencePart.PowerState`, and that field is not an enum
 * name: it is LOCALISED PROSE that `UpdateModuleUI()` writes from `Localizer`.
 * Comparing it against `"Powered"` and `"NoPower"` (a string KSP has never
 * emitted) drops `Unpowered`, `Disabled`, `Controller Disabled` and `N/A` off
 * the end into powered-with-a-partial-flag, so an unpowered cluster paints as a
 * working one on a reduced supply in English, and in any other language a fully
 * powered one does too.
 *
 * `DeployedPowerState` is OUR enum, derived mod-side from the four booleans
 * stock's own readout branches on, so it is an ordinal and it survives
 * translation. `powerState` is still on the wire and still shown, as the label
 * it always was.
 *
 * `partialPower` has no producer and never did: stock distinguishes powered from
 * not, with no partial state, and the flag only ever got set by the fall-through
 * that was the bug. It stays in the display shape (the render reads it) and is
 * now always false, rather than being removed in the same change as a behaviour
 * fix.
 */
function powerFromState(power: DeployedPowerState | null | undefined): {
  powered: boolean | null;
  partialPower: boolean;
} {
  // `power === DeployedPowerState.Powered` answered a definite FALSE for a
  // cluster the mod declined to state, so an unread base painted the red
  // "Unpowered" pill (`POWER_TONE.unpowered` is `nogo`) as confidently as a
  // genuinely dark one. Absence gets its own arm.
  if (power === null || power === undefined) {
    return { powered: null, partialPower: false };
  }
  return { powered: power === DeployedPowerState.Powered, partialPower: false };
}

/**
 * Groups the new wire's FLAT per-experiment list (see `parseBases`'s doc
 * comment) into the widget's existing `DeployedBase[]` display shape, keyed
 * by `vesselName`: a Breaking Ground cluster is its own vessel
 * (`Gonogo.KSP.KspHost.BuildDeployedScience`'s doc comment), so grouping by
 * vessel reproduces the legacy "one card per base" layout. Fields with no
 * new-wire equivalent degrade explicitly:
 * - `powerAvailable`/`powerRequired` -> the cluster's own power-unit balance,
 *   or `null` when it could not be read. This used to be hardcoded `0`/`0`
 *   under a comment claiming the wire had no numbers to give; it did, off the
 *   cluster the mod was already holding, and they are Breaking Ground power
 *   units rather than electric charge.
 * - `controllerEnabled` -> the mod's derived `controllerConnected` boolean.
 * - `id`/`partId` -> synthesized indices (stable within one payload, and
 *   never rendered as text: only used as React list keys).
 */
function groupFlatDeployedEntries(raw: unknown[]): DeployedBase[] {
  const order: string[] = [];
  const groups = new Map<string, FlatDeployedEntry[]>();
  for (const rawEntry of raw) {
    const entry = parseFlatDeployedEntry(rawEntry);
    if (!entry) continue;
    let list = groups.get(entry.vesselName);
    if (!list) {
      list = [];
      groups.set(entry.vesselName, list);
      order.push(entry.vesselName);
    }
    list.push(entry);
  }

  return order.map((vesselName, baseIndex) => {
    const entries = groups.get(vesselName) ?? [];
    const first = entries[0];
    const { powered, partialPower } = powerFromState(first?.power);
    const experiments: DeployedExperiment[] = entries.map((e, i) => {
      /* Every derivation below carries the absence rather than closing over it:
         a withheld completion percentage yields no progress, and therefore no
         `collecting` verdict either, because `pct < 100` is satisfied by the
         zero that used to stand in for it. */
      const progress = clamp01OrNull(
        e.scienceCompletedPercentage === null
          ? null
          : e.scienceCompletedPercentage / 100,
      );
      const transmittedShare = clamp01OrNull(
        e.scienceTransmittedPercentage === null
          ? null
          : e.scienceTransmittedPercentage / 100,
      );
      const transmitted =
        e.scienceValue === null || transmittedShare === null
          ? null
          : e.scienceValue * transmittedShare;
      return {
        partId: i,
        id: e.experimentId ?? `${vesselName}-${i}`,
        name: e.partName || e.experimentId || "Experiment",
        total: e.scienceValue,
        limit: e.scienceLimit,
        progress,
        stored:
          e.scienceValue === null || transmitted === null
            ? null
            : Math.max(0, e.scienceValue - transmitted),
        transmitted,
        collecting:
          e.scienceCompletedPercentage === null
            ? null
            : e.scienceCompletedPercentage < 100,
      };
    });
    return {
      id: baseIndex,
      body: first?.body ?? "",
      powered,
      partialPower,
      powerAvailable: first?.powerAvailable ?? null,
      powerRequired: first?.powerRequired ?? null,
      /*
       * The mod's derived boolean, not `connectionState === "Connected"`: that
       * compared against the English rendering of a localised sentence, so a
       * connected controller read as disconnected in every other language.
       */
      controllerEnabled: first?.controllerConnected ?? false,
      experimentCount: experiments.length,
      experiments,
    };
  });
}

/**
 * Parse `deployed.bases`. Returns null when the key is absent (older fork)
 * so the widget can tell "no DLC support" from "no bases deployed". Two wire
 * shapes land here:
 *
 * - **Legacy GonogoTelemetry shape**: grouped per-base objects, a numeric
 *   `id`, a `powerAvailable`/`powerRequired` balance, and a nested
 *   `experiments` list already keyed by numeric `partId`.
 * - **New SDK `deployed.bases`** (routed onto this key by
 *   `map-topic.ts`): a FLAT array of individual deployed
 *   experiments: one entry per `ModuleGroundExperiment`, no base grouping,
 *   `{ vesselName, partName, body, situation, biome, experimentId,
 *   scienceCompletedPercentage, scienceTransmittedPercentage, scienceValue,
 *   scienceLimit, powerState, connectionState, deployedOnGround }`
 *   (`mod/Sitrep.Host/ScienceViewProvider.cs`'s `BuildDeployedEntry`).
 *   `groupFlatDeployedEntries` above derives an equivalent `DeployedBase[]`
 *   client-side, grouped by `vesselName`.
 *
 * Detected by shape: a legacy entry always carries a numeric `id`; a
 * new-wire entry never does but always carries a string `vesselName`
 * instead. The two shapes never mix within one array (one source or the
 * other populates the whole payload), so the first recognizable entry
 * decides how the rest of the array is read.
 */
export function parseBases(raw: unknown): DeployedBase[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const entries: unknown[] = raw;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.vesselName === "string" && typeof e.id !== "number") {
      return groupFlatDeployedEntries(raw);
    }
    break;
  }

  const out: DeployedBase[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "number") continue;
    out.push({
      id: e.id,
      body: typeof e.body === "string" ? e.body : "",
      /* Narrowed rather than `=== true`, for the same reason the new wire arm
         is: the legacy shape can omit the flag, and the panel would then paint
         the red "Unpowered" pill for a cluster that never reported one. */
      powered: boolOrNull(e.powered),
      partialPower: e.partialPower === true,
      powerAvailable: numOrNull(e.powerAvailable),
      powerRequired: numOrNull(e.powerRequired),
      controllerEnabled: e.controllerEnabled === true,
      // Never rendered: the render counts `base.experiments` itself.
      experimentCount: num(e.experimentCount, 0),
      experiments: parseExperiments(e.experiments),
    });
  }
  return out;
}

type PowerState = "powered" | "partial" | "unpowered" | "unknown";

function powerState(base: DeployedBase): PowerState {
  if (base.powered === null) return "unknown";
  if (!base.powered) return "unpowered";
  return base.partialPower ? "partial" : "powered";
}

const POWER_LABEL: Record<PowerState, string> = {
  powered: "Powered",
  partial: "Brownout",
  unpowered: "Unpowered",
  // Matches the shape `powerBalance`'s "Power unknown" already uses on the
  // same card, and reads as an absence rather than as a fourth power state.
  unknown: "Power unknown",
};

const POWER_TONE: Record<PowerState, StatusTone> = {
  powered: "go",
  partial: "warn",
  unpowered: "nogo",
  // Neutral, not `nogo`: a red pill is a verdict, and there is none here.
  unknown: "neutral",
};

const XS2_STYLE = { fontSize: "var(--font-size-2xs)" } as const;

/**
 * The cluster's produced-over-required power balance, or null when either side
 * did not arrive. Both or neither: half a ratio is not a balance, and the
 * missing half would have to be drawn as something.
 *
 * `Units.Count` renders an empty display symbol, so the number carries no
 * suffix and the label has to say what scale it is on.
 */
function powerBalance(base: DeployedBase): string | null {
  const { powerAvailable, powerRequired } = base;
  if (powerAvailable === null || powerRequired === null) return null;
  return `Power ${Math.round(powerAvailable)}/${Math.round(powerRequired)}`;
}

/**
 * A completion fraction as a percentage that still says how current it is.
 *
 * `parseBases` normalises two wire shapes into one local number, so this figure
 * has no single field path to be read back through. What it does have is the
 * topic it came off, and that is what its currency is: as current as
 * `deployed.bases` was when the roster arrived.
 *
 * The fraction is taken already-narrowed rather than nullable, because the only
 * safe substitute for a missing completion is no figure at all: a zero here
 * claims an experiment has gathered nothing, and `collecting` (`pct < 100`) is
 * satisfied by that zero, so the card would report "gathered nothing and
 * actively working" about an experiment nobody has heard from.
 */
function progressPercentReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"%">> {
  return combineReadings([source], () => value("%", fraction * 100));
}

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  // A deployed-base roster is a fact: bases are planted by an event.
  //
  // The reading is NAMED rather than consumed inline because the progress
  // figure below is drawn from it and has to say how current it is. `stillTrue`
  // hands back a fact's payload through stale on purpose, so without the
  // reading beside it a held percentage draws as a present-tense claim.
  const basesReading = useTelemetry("deployed.bases");
  const basesRaw = stillTrue(basesReading, undefined);
  const available = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  // `parseBases` returns null for "could not read", which is the whole reason
  // it returns null: a `?? []` here discarded exactly that and the panel then
  // said "No deployed bases", a positive claim that nothing is planted
  // anywhere, before the first emission and on a mod that does not carry the
  // channel. An operator with four bases on Duna read that they had none.
  const bases = parseBases(basesRaw);

  if (bases === null || bases.length === 0) {
    return (
      <Panel
        panelTitle="DEPLOYED SCIENCE"
        compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
        sections={
          <Section>
            <EmptyState role="status">
              {available === false
                ? "Breaking Ground not installed"
                : bases === null
                  ? "Waiting for the deployed-base roster"
                  : "No deployed bases"}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="DEPLOYED SCIENCE"
      compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
      /* One section per base, so a landscape tile runs the base cards side by
         side instead of down one column. */
      sections={bases.map((base) => {
        const state = powerState(base);
        return (
          <Section key={base.id}>
            <Box
              bordered
              radius="xs"
              style={{
                padding: "var(--inset-surface)",
                borderColor: "var(--color-surface-raised)",
              }}
            >
              <Stack gap="sm">
                <Cluster style={{ gap: "var(--gap-related)" }}>
                  <Text tone="default" size="sm" style={{ fontWeight: 600 }}>
                    {base.body || "Surface base"}
                  </Text>
                  <StatusIndicator tone={POWER_TONE[state]} live>
                    {POWER_LABEL[state]}
                  </StatusIndicator>
                </Cluster>
                <Text tone="muted" style={XS2_STYLE}>
                  {/* Breaking Ground POWER UNITS, produced over required, not
                      electric charge: the label said "EC" over two hardcoded
                      zeros that no wire ever carried, so every base read
                      "Powered · EC 0/0". A cluster the mod could not read draws
                      no balance at all rather than a zero one, because zero is
                      what a live cluster reports with its panels dark. */}
                  {powerBalance(base) ?? "Power unknown"}
                  {base.experiments.length > 0 && (
                    <Text tone="faint" style={XS2_STYLE}>
                      {" "}
                      · {base.experiments.length} exp
                    </Text>
                  )}
                </Text>

                {base.experiments.map((exp) => (
                  <Stack gap="xs" key={`${base.id}-${exp.partId}`}>
                    <Cluster
                      align="baseline"
                      style={{ gap: "var(--gap-related)" }}
                    >
                      <Truncate style={XS2_STYLE}>{exp.name}</Truncate>
                      <Text tone="muted" style={XS2_STYLE}>
                        {exp.progress === null ? (
                          "Progress unknown"
                        ) : (
                          /* Drawn THROUGH the reading, so a percentage held
                             over from a link that stopped delivering is marked
                             rather than stated as current. */
                          <Unit
                            value={progressPercentReading(
                              basesReading,
                              exp.progress,
                            )}
                            decimals={0}
                          />
                        )}
                        {/* The dot is only lit on a verdict there was
                            something to derive. `collecting` was `pct < 100`,
                            which the substituted zero satisfied, so the card
                            read "gathered nothing and actively working" about
                            an experiment nobody had heard from. */}
                        {exp.collecting === true && (
                          <Text
                            tone="accent"
                            style={XS2_STYLE}
                            aria-hidden="true"
                          >
                            {" "}
                            ●
                          </Text>
                        )}
                      </Text>
                    </Cluster>
                    {/* Plain-div track (4px stadium, surface-raised) + go-toned
                        fill, preserving the original bar's exact dims/colour
                        rather than the generic ProgressBar (parity restore). No
                        bar at all without a reading: an empty track is 0%, and
                        `aria-valuenow={0}` states it outright. */}
                    {exp.progress !== null && (
                      <div
                        role="progressbar"
                        aria-label={`${exp.name} progress`}
                        aria-valuenow={Math.round(exp.progress * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        style={{
                          height: 4,
                          borderRadius: "var(--radius-pill)",
                          background: "var(--color-surface-raised)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, Math.max(0, exp.progress * 100))}%`,
                            background: "var(--color-status-go-bg)",
                          }}
                        />
                      </div>
                    )}
                    {/* Per-experiment-card body slot (augment-slot-map:
                        deployed-science.experiment). A Kerbalism Uplink appends a
                        background-transmission progress bar here; because the
                        slot renders once PER experiment card, its props carry
                        THIS card's experiment datum (and its body) so the
                        augment targets the right experiment. Renders nothing
                        until an augment binds. */}
                    <AugmentSlot
                      name="deployed-science.experiment"
                      props={{ experiment: exp, body: base.body }}
                    />
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Section>
        );
      })}
    />
  );
}

/**
 * Props passed to every `deployed-science.experiment` augment. The slot renders
 * once PER experiment card, so its props MUST carry that card's experiment
 * datum: a Kerbalism-style Uplink appends a background-transmission progress
 * bar and needs THIS experiment's identity/progress to target the right one.
 * `body` is the parent base's body, for context.
 */
export interface DeployedExperimentContext {
  /** The deployed experiment this card renders, the augment's datum. */
  experiment: DeployedExperiment;
  /** The body the parent base sits on, for context. */
  body: string;
}

// Declaration-merge this widget's slot ids → their props types into the sdk's
// `SlotRegistry`. Kept co-located here, not in a
// shared central registry file, so parallel per-widget slot work never
// collides. `.sections` is a typed-contract per-card slot, carrying the
// experiment.
//
// The target is `@ksp-gonogo/sitrep-sdk`, as it is for every other slot-owning
// widget in the mod tree: `@ksp-gonogo/core` is a module a third-party author
// cannot install, so a merge declared against it would simply never resolve
// for them, silently, leaving every augment of this slot typed as the loose
// fallback.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "deployed-science.experiment": DeployedExperimentContext;
  }
}

registerComponent<DeployedScienceConfig>({
  id: "deployed-science",
  name: "Deployed Science",
  description:
    "Power balance and per-experiment science progress for Breaking Ground deployed surface bases on every body, reported even while you fly something else. Read-only.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 5, h: 9 },
  /* Five rows, not four. At 4x4 the body scroller is 122px against 135px of
     content, and the thirteen pixels that puts past the fold turn on an
     overflow glow whose mask reaches seventeen, so "Waiting for the
     deployed-base roster" lost its last line to a cover it could not be read
     under. */
  minSize: { w: 4, h: 5 },
  component: DeployedScienceComponent,
  dataRequirements: ["deployed.bases", "game.dlc.breakingGround"],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["deployed-science.experiment"],
  pushable: true,
  owner: BREAKING_GROUND,
});

export { DeployedScienceComponent };
