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
  Meter,
  Panel,
  Section,
  Stack,
  StatusIndicator,
  type StatusTone,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { BREAKING_GROUND } from "../uplink";
import { boolOrNull, num, numOrNull } from "../wire";

/**
 * Every deployed Breaking Ground surface base on every body, loaded or not, with its power balance and per-experiment science progress.
 * Read-only: deployed science auto-transmits and background bases cannot be actioned remotely.
 */

type DeployedScienceConfig = Record<string, never>;

/**
 * One deployed experiment as the widget draws it.
 * Every figure is `null` when the mod withheld it, since 0% is a real reading, and `collecting` is `null` whenever the completion it derives from is.
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
  /** `null` when the mod declined to state the cluster's power state, which is a third answer and not "unpowered". */
  powered: boolean | null;
  partialPower: boolean;
  /** Breaking Ground's own integral power units, not electric charge; a live cluster with dark panels reports 0. */
  powerAvailable: number | null;
  powerRequired: number | null;
  controllerEnabled: boolean;
  experimentCount: number;
  experiments: DeployedExperiment[];
}

/** A fact's value, held through stale; `whenConfirmedNothing` is what an `absent` tombstone means, distinct from `pending`. */
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
      // A React list key, never rendered, so a substitute states nothing about the craft.
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

/** One flat entry off the `deployed.bases` wire; see `parseBases`. */
interface FlatDeployedEntry {
  vesselName: string;
  partName: string | null;
  body: string | null;
  experimentId: string | null;
  /** The four science figures, `null` when the mod withheld one; a freshly planted experiment reports 0%. */
  scienceCompletedPercentage: number | null;
  scienceTransmittedPercentage: number | null;
  scienceValue: number | null;
  scienceLimit: number | null;
  /** Localised prose, display only. {@link power} is the field to branch on. */
  powerState: string | null;
  /** Localised prose, display only. See {@link controllerConnected}. */
  connectionState: string | null;
  /** The mod's derived power state; `null` is a third answer, not "unpowered". */
  power: DeployedPowerState | null;
  /** The mod's derived controller-attachment fact. */
  controllerConnected: boolean | null;
  /** The cluster's power balance in Breaking Ground's own power units; see {@link DeployedBase.powerAvailable}. */
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
 * Maps the mod's derived `DeployedPowerState` onto the `powered`/`partialPower` pair.
 * Branch on this ordinal, never on the localised `powerState` prose. Stock has no partial state, so `partialPower` is always false.
 */
function powerFromState(power: DeployedPowerState | null | undefined): {
  powered: boolean | null;
  partialPower: boolean;
} {
  // An unstated power state is unknown, not unpowered.
  if (power === null || power === undefined) {
    return { powered: null, partialPower: false };
  }
  return { powered: power === DeployedPowerState.Powered, partialPower: false };
}

/**
 * Groups the flat per-experiment list into one `DeployedBase` per `vesselName`, since a Breaking Ground cluster is its own vessel.
 * `id` and `partId` are synthesised indices, used only as React keys.
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
      // Every derivation carries the absence: a withheld completion yields no progress and no `collecting` verdict.
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
      // The derived boolean, never the localised `connectionState` prose.
      controllerEnabled: first?.controllerConnected ?? false,
      experimentCount: experiments.length,
      experiments,
    };
  });
}

/**
 * Parses `deployed.bases`, returning null when it could not be read so "no bases deployed" stays a claim only a real empty list makes.
 * Accepts grouped per-base entries (a numeric `id`) or a flat per-experiment list (a string `vesselName`); the shapes never mix, so the first recognisable entry decides.
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
      // An omitted flag is unknown, not unpowered.
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
  unknown: "Power unknown",
};

const POWER_TONE: Record<PowerState, StatusTone> = {
  powered: "go",
  partial: "warn",
  unpowered: "nogo",
  // Neutral, not `nogo`: a red pill is a verdict, and there is none here.
  unknown: "neutral",
};

const XS2_STYLE = { fontSize: "var(--font-size-caption)" } as const;

/** The produced-over-required power balance, or null unless both sides arrived. */
function powerBalance(base: DeployedBase): string | null {
  const { powerAvailable, powerRequired } = base;
  if (powerAvailable === null || powerRequired === null) return null;
  return `Power ${Math.round(powerAvailable)}/${Math.round(powerRequired)}`;
}

/** A completion fraction as a percentage, exactly as current as `deployed.bases` is. */
function progressPercentReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"%">> {
  return combineReadings([source], () => value("%", fraction * 100));
}

/** The same completion as the 0..1 fraction a meter's bar is drawn from. */
function progressRatioReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"ratio">> {
  return combineReadings([source], () => value("ratio", fraction));
}

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  // The roster is a fact, held through stale; the reading stays named so each progress figure can carry its currency.
  const basesReading = useTelemetry("deployed.bases");
  const basesRaw = stillTrue(basesReading, undefined);
  const available = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  // Null is "could not read", never "no deployed bases".
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
      /* One section per base, so a landscape tile runs the cards side by side. */
      sections={bases.map((base) => {
        const state = powerState(base);
        return (
          <Section key={base.id}>
            <Box
              bordered
              radius="regular"
              style={{
                padding: "var(--inset-surface)",
                borderColor: "var(--color-surface-raised)",
              }}
            >
              <Stack>
                <Cluster style={{ gap: "var(--gap-related)" }}>
                  <Text tone="default" size="sm" style={{ fontWeight: 600 }}>
                    {base.body || "Surface base"}
                  </Text>
                  <StatusIndicator tone={POWER_TONE[state]} live>
                    {POWER_LABEL[state]}
                  </StatusIndicator>
                </Cluster>
                <Text tone="muted" style={XS2_STYLE}>
                  {/* Breaking Ground power units, not electric charge. */}
                  {powerBalance(base) ?? "Power unknown"}
                  {base.experiments.length > 0 && (
                    <Text tone="faint" style={XS2_STYLE}>
                      {" "}
                      · {base.experiments.length} exp
                    </Text>
                  )}
                </Text>

                {base.experiments.map((exp) => (
                  <Stack key={`${base.id}-${exp.partId}`}>
                    {/* Drawn through the reading so a held percentage is marked; no completion draws the absent form, not an empty track. */}
                    <Meter
                      label={exp.name}
                      tone="go"
                      value={
                        exp.progress === null
                          ? null
                          : progressRatioReading(basesReading, exp.progress)
                      }
                      valueLabelNode={
                        exp.progress === null ? undefined : (
                          <>
                            <Unit
                              value={progressPercentReading(
                                basesReading,
                                exp.progress,
                              )}
                              decimals={0}
                            />
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
                          </>
                        )
                      }
                    />
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

/** Props passed to every `deployed-science.experiment` augment, rendered once per experiment card. */
export interface DeployedExperimentContext {
  /** The deployed experiment this card renders, the augment's datum. */
  experiment: DeployedExperiment;
  /** The body the parent base sits on, for context. */
  body: string;
}

// Merged into the sdk's `SlotRegistry`, since a merge against the private `@ksp-gonogo/core` would silently never resolve for an outside author.
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
  // At four rows the overflow glow covers the last line of the empty state.
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
