import type { ComponentProps, VesselTopology } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useContributions,
  useCrashEnding,
} from "@ksp-gonogo/core";
import { usePartsLive, useTopology } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  type CommandId,
  type UseCommandResult,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-sdk";
import { Panel } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Side-effect import: registers the built-in `ship-map.part-meters` contribution.
import "./partMetersContribution";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import { externalTempTint } from "./ambientTint";
import { groupByPart } from "./groupByPart";
import { INVOKE_PART_ACTION_COMMAND } from "./PartActionMenu";
import { seatRadialParts } from "./radialSeat";
import { shipMapSections } from "./ShipMapBody";
import { StageColumn, showsStagesOnly } from "./StageColumn";
import read from "./ship-map.declarations.g";
import { computeShipLayout } from "./shipLayout";
import {
  buildShipMapPart,
  type ShipMapPart,
  type ShipMapPartActionEntry,
  type ShipMapPartMetaEntry,
  type ShipMapPartMeterEntry,
} from "./shipTopology";
import { turnedView, VIEW_STEPS_PER_TURN } from "./shipView";
import type { ShipMapOverlayContext } from "./slots";
import { buildStageStack } from "./stageStack";
import { useBaseView } from "./useBaseView";
import { usePartShapes } from "./usePartShapes";

const topics = defineTopicManifest({
  channels: [
    "vessel.parts",
    "vessel.thermal",
    "vessel.flight",
    "vessel.control",
    "vessel.propulsion",
    "vessel.structure",
    "crash.hasRecent",
    "crash.lastCrash",
  ],
  // Only what the diagram draws: ThermalStatus draws the rest of `vessel.thermal`, and its alarms do not belong here.
  fields: [
    "vessel.parts",
    "vessel.thermal.hottestPart.id",
    "vessel.flight.externalTemperature",
    "vessel.control.throttle",
    "vessel.propulsion.currentThrust",
    "vessel.structure.currentStage",
    "crash.lastCrash",
  ],
});

export type { ShipMapOverlayContext } from "./slots";
// Re-exported from the widget root like every other slot-context type; authored in `shipTopology.ts` to avoid an import cycle.
export type {
  ShipMapPartActionEntry,
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
};

interface ShipMapConfig {
  /** Presses of the rotate control the view is turned from its default, 0 to 7. A presentation setting of this widget, never sent to the game. */
  turn?: number;
}

function ShipMapComponent({
  config,
  w,
  onConfigChange,
}: Readonly<ComponentProps<ShipMapConfig>>) {
  const turn = normaliseTurn(config?.turn);
  const setTurn = useCallback(
    (next: number) => {
      onConfigChange?.({ ...(config ?? {}), turn: normaliseTurn(next) });
    },
    [config, onConfigChange],
  );
  // The mod's channel engine is change-gated, so no seq-driven refetch is needed.
  const liveTopology = useTopology();
  const crash = useCrashEnding();
  /*
   * The game drops a destroyed craft's parts, so the last topology is kept to
   * go on drawing it. It is used only where the crash report names parts of it:
   * a topology that shares none with the report belongs to another craft.
   */
  const lastTopology = useRef<VesselTopology | undefined>(undefined);
  if (liveTopology) lastTopology.current = liveTopology;
  const lostIds = useMemo(
    () =>
      new Set(
        Array.isArray(crash?.partsLost)
          ? crash.partsLost.map((p) => String(p.partId))
          : [],
      ),
    [crash],
  );
  /*
   * The report lists the part that broke first at its head when an impact
   * caused the death. A burn-up names no such part, and its list is in no
   * order a reader could use.
   */
  const impactId =
    crash &&
    (crash.eventKind === "Crash" || crash.eventKind === "CrashSplashdown") &&
    Array.isArray(crash.partsLost) &&
    crash.partsLost.length > 0
      ? String(crash.partsLost[0].partId)
      : undefined;
  const topology =
    liveTopology ??
    (lastTopology.current?.parts.some((p) => lostIds.has(String(p.flightId)))
      ? lastTopology.current
      : undefined);
  const destroyed =
    crash && topology?.parts.some((p) => lostIds.has(String(p.flightId)))
      ? crash
      : liveTopology
        ? undefined
        : crash;
  // "Hottest part" is a verdict about now, so only a current reading rings the part.
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const hottestPart =
    thermalReading.state === "observed" || thermalReading.state === "held"
      ? thermalReading.value.hottestPart
      : undefined;
  // Ambient skin temperature tints the diagram background; a dated number, so the last observation is used.
  const flightReading = topics.useTelemetry("vessel.flight");
  const externalTemperature = magnitudeOf(
    flightReading.state === "observed" || flightReading.state === "held"
      ? flightReading.value.externalTemperature
      : undefined,
  );
  // Throttle gates the engine flame: the last confirmed throttle, zero on a cold start.
  const controlReading = topics.useTelemetry("vessel.control");
  const throttle = magnitudeOr(
    controlReading.state === "observed" || controlReading.state === "held"
      ? controlReading.value.throttle
      : undefined,
    0,
  );
  // A solid booster burns at any throttle, so its flame follows the thrust the vessel makes, the one reading true for every engine kind.
  const propulsionReading = topics.useTelemetry("vessel.propulsion");
  const thrusting =
    (propulsionReading.state === "observed" ||
      propulsionReading.state === "held") &&
    propulsionReading.value.currentThrust?.isPositive() === true;

  // The marked stage is a verdict about now, so only a current reading names it; a held one leaves the stack unmarked.
  const structureReading = topics.useTelemetry("vessel.structure");
  const currentStage =
    structureReading.state === "observed"
      ? structureReading.value.currentStage
      : undefined;

  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);
  // The live fields on every part come off this one reading, so it dates them for an overlay.
  const partsReading = topics.useTelemetry("vessel.parts");

  // Grouped by partId once, so the in-body bars and the hover tooltip read the same lookup.
  const meterContributions = useContributions("ship-map.part-meters");
  const metaContributions = useContributions("ship-map.part-meta");
  const actionContributions = useContributions("ship-map.part-actions");
  const partMeters = useMemo(
    () => groupByPart(meterContributions, (e) => `${e.partId}:${e.resource}`),
    [meterContributions],
  );
  const partMeta = useMemo(
    () => groupByPart(metaContributions, (e) => `${e.partId}:${e.label}`),
    [metaContributions],
  );

  const partActions = useMemo(
    () => groupByPart(actionContributions, (e) => `${e.partId}:${e.name}`),
    [actionContributions],
  );
  const contributedCommands = useMemo(
    () => [...new Set(actionContributions.map((e) => e.command))].sort(),
    [actionContributions],
  );
  // The latest handle for each command a contributed button can send, registered by its host below.
  const contributedHandles = useRef(
    new Map<string, UseCommandResult<Record<string, unknown>>>(),
  );
  const registerHandle = useCallback(
    (
      command: string,
      handle: UseCommandResult<Record<string, unknown>> | null,
    ) => {
      if (handle) contributedHandles.current.set(command, handle);
      else contributedHandles.current.delete(command);
    },
    [],
  );
  const contributedActionCommand = useCallback(
    (entry: ShipMapPartActionEntry, partTitle: string) =>
      contributedHandles.current
        .get(entry.command)
        ?.with(
          { ...entry.args },
          { label: `${entry.label} on ${partTitle}` },
        ) ?? null,
    [],
  );

  // The default angle is found when a craft appears, and every part shares the one view.
  const baseView = useBaseView(topology);
  // Each part is drawn from its kind's 3D shape once that has arrived, and from its outline until then.
  const { shapes, sources: shapeSources } = usePartShapes(topology?.parts);
  const parts: ShipMapPart[] = useMemo(() => {
    if (!topology) return [];
    const view = turnedView(baseView, turn);
    const seated = seatRadialParts(topology.parts, (key) => shapes.get(key));
    return seated.map((p) => {
      const live = liveByFlightId.get(p.flightId);
      const part = buildShipMapPart(
        p,
        live?.thermal,
        live?.resources,
        view,
        live?.partState,
        p.shape ? shapes.get(p.shape) : undefined,
      );
      return impactId === String(p.flightId) ? { ...part, impact: true } : part;
    });
  }, [topology, liveByFlightId, baseView, turn, shapes, impactId]);

  // Stages already fired are left out, as the in-game stack drops them.
  const stages = useMemo(
    () => buildStageStack(parts, currentStage).filter((s) => !s.spent),
    [parts, currentStage],
  );

  // A state-backed ref so the effect re-attaches when DiagramWrap mounts, which happens only once topology exists.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });
  useEffect(() => {
    if (!wrapEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const rect = e.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setSize({
            w: Math.floor(rect.width),
            h: Math.floor(rect.height),
          });
        }
      }
    });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  // The command handle lives at the always-mounted widget: the menu closes when an action fires, and its in-flight delay row must outlive it.
  const invokePartAction = useCommand(INVOKE_PART_ACTION_COMMAND);

  const partActionCommand = useCallback(
    (
      flightId: number,
      eventName: string,
      actionLabel: string,
      partTitle: string,
    ) =>
      invokePartAction.with(
        // The wire keys parts by stringified flightID, the form every cross-channel join uses.
        { partId: String(flightId), eventName },
        // Operator-facing description for the delay readouts: the raw event name alone would not say which part it acts on.
        { label: `${actionLabel} on ${partTitle}` },
      ),
    [invokePartAction],
  );

  const hottestPartId =
    thermalReading.state === "observed" && typeof hottestPart?.id === "string"
      ? hottestPart.id
      : null;

  const ambientTint = useMemo(
    () => externalTempTint(externalTemperature),
    [externalTemperature],
  );

  // `overlay` is null until parts resolve.
  const overlayContext: ShipMapOverlayContext | null = useMemo(() => {
    if (parts.length === 0) return null;
    const { bounds, baseScale, padding } = computeShipLayout(
      parts,
      size.w,
      size.h,
    );
    return {
      parts,
      width: size.w,
      height: size.h,
      bounds,
      baseScale,
      padding,
      held: withoutReckoning(partsReading),
    };
  }, [parts, size, partsReading]);

  return (
    <>
      {contributedCommands.map((command) => (
        <ContributedCommandHost
          key={command}
          command={command}
          register={registerHandle}
        />
      ))}
      {shapeSources}
      <Panel
        panelTitle="VESSEL SCHEMATIC"
        panelSidebar={
          stages.length > 0 && !showsStagesOnly(w) ? (
            <StageColumn stages={stages} />
          ) : undefined
        }
        sidebarSize="9rem"
        sidebarPlacement="beside"
        panelBadges={
          destroyed
            ? [
                {
                  id: "destroyed",
                  label: "Destroyed",
                  tone: "nogo",
                  title: "The crash report names this craft as destroyed",
                },
              ]
            : []
        }
        sections={shipMapSections({
          stagesOnly: showsStagesOnly(w),
          destroyed,
          topology,
          parts,
          hottestPartId,
          size,
          setWrapEl,
          ambientTint,
          throttle,
          thrusting,
          overlayContext,
          partMeters,
          partMeta,
          partActions,
          contributedActionCommand,
          partActionCommand,
          turn,
          onTurn: setTurn,
          stages,
        })}
      />
    </>
  );
}

/**
 * Holds the delay-aware command handle for one command a contributed button
 * sends, mounted for as long as a contribution names it so a dispatch's delay
 * row outlives the menu that fired it. Hooks cannot be called per entry, hence
 * one host per distinct command.
 */
function ContributedCommandHost({
  command,
  register,
}: Readonly<{
  command: CommandId;
  register: (
    command: string,
    handle: UseCommandResult<Record<string, unknown>> | null,
  ) => void;
}>) {
  // gonogo:reads none
  const handle = useCommand<Record<string, unknown>>(command);
  useEffect(() => {
    register(command, handle);
  });
  useEffect(() => () => register(command, null), [command, register]);
  return null;
}

function normaliseTurn(turn: number | undefined): number {
  if (typeof turn !== "number" || !Number.isFinite(turn)) return 0;
  return (
    ((Math.round(turn) % VIEW_STEPS_PER_TURN) + VIEW_STEPS_PER_TURN) %
    VIEW_STEPS_PER_TURN
  );
}

registerComponent<ShipMapConfig>({
  id: "ship-map",
  name: "Vessel Schematic",
  description:
    "A view of your vessel part by part, side-on for a rocket and from above for a plane, turnable in steps, each part tinted by its heat, with fill bars on tanks and boosters and the hottest part picked out.",
  tags: ["telemetry", "ship", "staging", "stages"],
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 5, h: 5 },
  component: ShipMapComponent,
  augmentSlots: ["ship-map.overlay"],
  // The built-in contribution always fills part-meters; an Uplink may fill both.
  contributionSlots: [
    "ship-map.part-meters",
    "ship-map.part-meta",
    "ship-map.part-actions",
  ],
  // Per-part thermal, resources and module state all ride the one `vessel.parts` payload.
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ShipMapComponent };
