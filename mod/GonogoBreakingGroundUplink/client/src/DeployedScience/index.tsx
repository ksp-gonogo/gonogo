import type { ComponentProps, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  DeployedPowerState,
  registerComponent,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Box,
  Cluster,
  EmptyState,
  magnitudeOr,
  Panel,
  type Quantityish,
  Stack,
  StatusIndicator,
  type StatusTone,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { BREAKING_GROUND } from "../uplink";

/**
 * Deployed Base Monitor (Breaking Ground). Lists every deployed surface
 * science base on every body (loaded or not), with its power balance and
 * per-experiment science progress toward cap. Read-only: deployed science
 * auto-transmits and background bases can't be actioned remotely.
 *
 * Reads `deployed.bases` + `deployed.available`; degrades to a muted empty
 * state without Breaking Ground or when no base is deployed.
 *
 * `deployed.bases` is migrated, `map-topic.ts` routes it onto the new
 * `deployed.bases` stream topic (`mod/Sitrep.Host/ScienceViewProvider.cs`'s
 * `BuildDeployed`, itself fed by `Gonogo.KSP.KspHost.BuildDeployedScience`'s
 * GLOBAL `FlightGlobals.Vessels` walk: a Breaking Ground cluster is its own
 * vessel, never the active one). `parseBases` below now accepts BOTH wire
 * shapes; see its own doc comment for the field-by-field mapping.
 * `deployed.available` is migrated too, the earlier "no new-wire
 * equivalent" read was stale: `game.dlc.breakingGround` is its
 * own independent capability boolean, not derived from `deployed.bases`'s
 * emptiness (see `map-topic.ts`'s `LEGACY_KEY_HOMES`).
 *
 * Real-recording validation is deferred to the user's next Space Center
 * capture with a deployed Breaking Ground cluster in physics range, this
 * migration validates against a hand-authored real-shape SYNTHETIC fixture
 * (`.superpowers/sdd/m3-deployedscience-report.md`).
 */

type DeployedScienceConfig = Record<string, never>;

export interface DeployedExperiment {
  partId: number;
  id: string;
  name: string;
  total: number;
  limit: number;
  progress: number;
  stored: number;
  transmitted: number;
  collecting: boolean;
}

export interface DeployedBase {
  id: number;
  body: string;
  powered: boolean;
  partialPower: boolean;
  powerAvailable: number;
  powerRequired: number;
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
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * A wire field as a number.
 *
 * Takes a `Value` as well as a bare number: a declared quantity arrives
 * wrapped from the decode, and a `typeof === "number"` test answers "no
 * reading" for every one of them, which is silent and total.
 */
function num(v: unknown, fallback = 0): number {
  return magnitudeOr(v as Quantityish, fallback);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function parseExperiments(raw: unknown): DeployedExperiment[] {
  if (!Array.isArray(raw)) return [];
  const out: DeployedExperiment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      partId: num(e.partId),
      id: typeof e.id === "string" ? e.id : "",
      name: typeof e.name === "string" && e.name ? e.name : "Experiment",
      total: num(e.total),
      limit: num(e.limit),
      progress: clamp01(num(e.progress)),
      stored: num(e.stored),
      transmitted: num(e.transmitted),
      collecting: e.collecting === true,
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
  scienceCompletedPercentage: number;
  scienceTransmittedPercentage: number;
  scienceValue: number;
  scienceLimit: number;
  /** Localised prose, display only. {@link power} is the field to branch on. */
  powerState: string | null;
  /** Localised prose, display only. See {@link controllerConnected}. */
  connectionState: string | null;
  /** The mod's derived power state. Null when it could not be determined, which
   *  is a third answer and not "unpowered". */
  power: DeployedPowerState | null;
  /** The mod's derived controller-attachment fact. */
  controllerConnected: boolean | null;
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
    scienceCompletedPercentage: num(e.scienceCompletedPercentage),
    scienceTransmittedPercentage: num(e.scienceTransmittedPercentage),
    scienceValue: num(e.scienceValue),
    scienceLimit: num(e.scienceLimit),
    powerState: typeof e.powerState === "string" ? e.powerState : null,
    connectionState:
      typeof e.connectionState === "string" ? e.connectionState : null,
    power: typeof e.power === "number" ? (e.power as DeployedPowerState) : null,
    controllerConnected:
      typeof e.controllerConnected === "boolean" ? e.controllerConnected : null,
  };
}

/**
 * The mod's derived `DeployedPowerState` -> this widget's
 * `powered`/`partialPower` pair.
 *
 * This read `ModuleGroundSciencePart.PowerState`, and that field is not an enum
 * name: it is LOCALISED PROSE that `UpdateModuleUI()` writes from `Localizer`.
 * The old comparison tested it against `"Powered"` and against `"NoPower"`, a
 * string KSP has never emitted, so `Unpowered`, `Disabled`,
 * `Controller Disabled` and `N/A` all fell off the end into powered-with-a-
 * partial-flag. An unpowered cluster painted as a working one on a reduced
 * supply, in English, and in any other language a fully powered one did too.
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
  powered: boolean;
  partialPower: boolean;
} {
  return { powered: power === DeployedPowerState.Powered, partialPower: false };
}

/**
 * Groups the new wire's FLAT per-experiment list (see `parseBases`'s doc
 * comment) into the widget's existing `DeployedBase[]` display shape, keyed
 * by `vesselName`: a Breaking Ground cluster is its own vessel
 * (`Gonogo.KSP.KspHost.BuildDeployedScience`'s doc comment), so grouping by
 * vessel reproduces the legacy "one card per base" layout. Fields with no
 * new-wire equivalent degrade explicitly:
 * - `powerAvailable`/`powerRequired` -> `0`/`0` (only the coarse
 *   `powerState` enum exists, no EC numbers).
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
      const progress = clamp01(e.scienceCompletedPercentage / 100);
      const transmitted =
        e.scienceValue * clamp01(e.scienceTransmittedPercentage / 100);
      return {
        partId: i,
        id: e.experimentId ?? `${vesselName}-${i}`,
        name: e.partName || e.experimentId || "Experiment",
        total: e.scienceValue,
        limit: e.scienceLimit,
        progress,
        stored: Math.max(0, e.scienceValue - transmitted),
        transmitted,
        collecting: e.scienceCompletedPercentage < 100,
      };
    });
    return {
      id: baseIndex,
      body: first?.body ?? "",
      powered,
      partialPower,
      powerAvailable: 0,
      powerRequired: 0,
      // The mod's derived boolean, not `connectionState === "Connected"`: that
      // compared against the English rendering of a localised sentence, so a
      // connected controller read as disconnected in every other language.
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
 *   `id`, an EC `powerAvailable`/`powerRequired` balance, and a nested
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

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.vesselName === "string" && typeof e.id !== "number") {
      return groupFlatDeployedEntries(raw);
    }
    break;
  }

  const out: DeployedBase[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "number") continue;
    out.push({
      id: e.id,
      body: typeof e.body === "string" ? e.body : "",
      powered: e.powered === true,
      partialPower: e.partialPower === true,
      powerAvailable: num(e.powerAvailable),
      powerRequired: num(e.powerRequired),
      controllerEnabled: e.controllerEnabled === true,
      experimentCount: num(e.experimentCount),
      experiments: parseExperiments(e.experiments),
    });
  }
  return out;
}

type PowerState = "powered" | "partial" | "unpowered";

function powerState(base: DeployedBase): PowerState {
  if (!base.powered) return "unpowered";
  return base.partialPower ? "partial" : "powered";
}

const POWER_LABEL: Record<PowerState, string> = {
  powered: "Powered",
  partial: "Brownout",
  unpowered: "Unpowered",
};

const POWER_TONE: Record<PowerState, StatusTone> = {
  powered: "go",
  partial: "warn",
  unpowered: "nogo",
};

const XS2_STYLE = { fontSize: "var(--font-size-2xs)" } as const;

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  // A deployed-base roster is a fact: bases are planted by an event.
  const basesRaw = stillTrue(useTelemetry("deployed.bases"), undefined);
  const available = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  const bases = parseBases(basesRaw) ?? [];

  if (bases.length === 0) {
    return (
      <Panel panelTitle="DEPLOYED SCIENCE">
        <EmptyState role="status">
          {available === false
            ? "Breaking Ground not installed"
            : "No deployed bases"}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel panelTitle="DEPLOYED SCIENCE">
      <Stack
        gap="md"
        style={{ padding: "var(--space-4) var(--space-8) var(--space-8)" }}
      >
        {bases.map((base) => {
          const state = powerState(base);
          return (
            <Box
              key={base.id}
              bordered
              radius="xs"
              style={{
                padding: "var(--space-6) var(--space-8)",
                borderColor: "var(--color-surface-raised)",
              }}
            >
              <Stack gap="sm">
                <Cluster style={{ gap: "var(--space-6)" }}>
                  <Text tone="default" size="sm" style={{ fontWeight: 600 }}>
                    {base.body || "Surface base"}
                  </Text>
                  <StatusIndicator tone={POWER_TONE[state]} live>
                    {POWER_LABEL[state]}
                  </StatusIndicator>
                </Cluster>
                <Text tone="muted" style={XS2_STYLE}>
                  EC {Math.round(base.powerAvailable)}/
                  {Math.round(base.powerRequired)}
                  {base.experiments.length > 0 && (
                    <Text tone="faint" style={XS2_STYLE}>
                      {" "}
                      · {base.experiments.length} exp
                    </Text>
                  )}
                </Text>

                {base.experiments.map((exp) => (
                  <Stack gap="xs" key={`${base.id}-${exp.partId}`}>
                    <Cluster align="baseline" style={{ gap: "var(--space-6)" }}>
                      <Truncate style={XS2_STYLE}>{exp.name}</Truncate>
                      <Text tone="muted" style={XS2_STYLE}>
                        <Unit
                          value={value("%", exp.progress * 100)}
                          decimals={0}
                        />
                        {exp.collecting && (
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
                        rather than the generic ProgressBar (parity restore). */}
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
          );
        })}
      </Stack>
    </Panel>
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
// `SlotRegistry` (Uplink architecture §4.6). Kept co-located here, not in a
// shared central registry file, so parallel per-widget slot work never
// collides. `.sections` is a typed-contract per-card slot, carrying the
// experiment.
//
// The target is `@ksp-gonogo/sitrep-sdk`, as it is for every other slot-owning
// widget in the mod tree. This one named `@ksp-gonogo/core` until 2026-08-18,
// which is a module a third-party author cannot install and therefore cannot
// augment: the merge would simply never resolve for them, silently, leaving
// every augment of this slot typed as the loose fallback.
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
  minSize: { w: 4, h: 4 },
  component: DeployedScienceComponent,
  dataRequirements: ["deployed.bases", "game.dlc.breakingGround"],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["deployed-science.experiment"],
  pushable: true,
  owner: BREAKING_GROUND,
});

export { DeployedScienceComponent };
