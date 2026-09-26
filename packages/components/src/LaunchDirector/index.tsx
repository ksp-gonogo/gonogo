import type {
  ActionDefinition,
  ActionInputPayload,
  ComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useActionInput,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  useCommand,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  KSP_EDITOR_FACILITY_NAMES,
  stillTrue,
  TargetKind,
  type TargetListEntry,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandButtonHandle,
  commandLossSentence,
  Disclosure,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Spinner,
  Unit,
  useCommandButton,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
import { asQuantityish, magnitudeOf, magnitudeOr } from "../shared/magnitude";

type LaunchDirectorConfig = Record<string, never>;

/**
 * One action per control that has exactly one target on screen. Each presses
 * the control itself, so a bound input arms then dispatches exactly as clicks
 * do, and does nothing while the control is dark or absent.
 */
const launchDirectorActions = [
  {
    id: "launch",
    label: "Launch",
    accepts: ["button"],
    description:
      "First press arms, second press launches the craft selected on the open pad, with the crew selected for it.",
  },
  {
    id: "recover",
    label: "Recover",
    accepts: ["button"],
    description:
      "First press arms, second press recovers the vessel in flight, or the one standing on the open pad.",
  },
  {
    id: "revertToLaunch",
    label: "Revert to launch",
    accepts: ["button"],
    description:
      "In flight: first press arms, second press reverts the flight to its launch.",
  },
  {
    id: "revertToEditor",
    label: "Revert to VAB",
    accepts: ["button"],
    description:
      "First press arms, second press reverts the flight, or the vessel on the open pad, to the VAB.",
  },
  {
    id: "trackingStation",
    label: "Tracking Station",
    accepts: ["button"],
    description:
      "In flight: first press arms, second press saves the game and leaves for the Tracking Station.",
  },
] as const satisfies readonly ActionDefinition[];

export type LaunchDirectorActions = typeof launchDirectorActions;
type LaunchDirectorActionId = LaunchDirectorActions[number]["id"];

type Press = (armable: boolean) => void;

/** Each bound control's press, listed only while a click on it would do something. */
const BoundPresses = createContext<Map<LaunchDirectorActionId, Press> | null>(
  null,
);

function useBindPress(
  action: LaunchDirectorActionId | undefined,
  press: Press,
  clickable: boolean,
): void {
  const registry = useContext(BoundPresses);
  useEffect(() => {
    if (!registry || !action || !clickable) return;
    registry.set(action, press);
    return () => {
      if (registry.get(action) === press) registry.delete(action);
    };
  }, [registry, action, press, clickable]);
}

/** The context both LaunchDirector slots pass to their augments: the pre-launch selection the operator is about to commit. */
export interface LaunchDirectorSlotContext {
  /** Current KSP scene, undefined until telemetry arrives and while the mod cannot name it. */
  scene: string | undefined;
  /** True while a vessel is in flight (scene === "Flight"). */
  inFlight: boolean;
  /** The saved craft selected in the pre-launch picker, or null when none. */
  selectedShip: string | null;
  /** The chosen launch-site name (e.g. "LaunchPad"). */
  selectedSite: string;
  /** Crew names the operator has selected for the launch. */
  selectedCrew: string[];
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

/**
 * One pad, as the row that draws it sees it. An Uplink that models launch
 * complexes joins its own pad record on {@link siteName}. Per-row, so a pad an
 * Uplink knows is busy can say so from the row.
 */
export interface LaunchDirectorPadContext {
  /** The site's internal `LaunchSite.name`: the stable key an Uplink joins on. */
  siteName: string;
  /** The site's human-facing name, as the row shows it. */
  displayName: string;
  /** KSP's `EditorFacility` name for this site: a `VAB` site is a pad, an `SPH` site a runway. */
  editorFacility: string;
  /** Whether a vessel is standing on this pad; `null` when this site reports no occupancy. */
  occupied: boolean | null;
  /** The occupying vessel's name, `null` when none is reported. */
  occupantName: string | null;
  /** Whether this is the pad the operator has opened, so an augment can spend more room on it. */
  expanded: boolean;
  /** Career funds balance; undefined in sandbox/science or before telemetry. */
  funds: number | undefined;
}

// Declaration-merge the slot ids onto their props type in core's `SlotRegistry`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "launch-director.preflight": LaunchDirectorSlotContext;
    "launch-director.pad": LaunchDirectorPadContext;
  }
}

export interface SavedShip {
  name: string;
  partCount: number;
  totalMass: number;
  /** KSP's own `EditorFacility` name, verbatim: the label shown on the row. */
  facility: string;
  /** KSP's `EditorFacility` ORDINAL, `null` when none was sent: what decides the launch editor; {@link facility} is display only. */
  facilityOrdinal: number | null;
  requiresFunds: number;
  missingParts: string[];
}

export interface CrewMember {
  name: string;
  trait: string;
  experienceLevel: number;
  /** Whether this kerbal can fly today, or `null` where the wire said nothing, which is not false. */
  available: boolean | null;
  unavailableReason: string;
}

/** What a crew row can be, once availability and its reason are read together. */
export type CrewReading = "available" | "unavailable" | "unread";

/**
 * Availability and its reason read together. Unavailable with an EMPTY reason
 * is the third state: `CrewStanding.Unknown` carries no reason on purpose, so
 * that is how "nothing could say" arrives.
 */
export function crewReading(k: CrewMember): CrewReading {
  if (k.available === true) return "available";
  if (k.available === false && k.unavailableReason !== "") return "unavailable";
  return "unread";
}

/**
 * The roster's own count and the three exceptions to it, each silent at zero.
 * The selected count lives here because this line is the part that survives a
 * short tile when the grid folds.
 */
export function crewTally(crew: CrewMember[], selected = 0): string {
  const readings = crew.map(crewReading);
  const unavailable = readings.filter((r) => r === "unavailable").length;
  const unread = readings.filter((r) => r === "unread").length;
  const terms = [`(${crew.length})`];
  if (unavailable > 0) terms.push(`${unavailable} unavailable`);
  if (unread > 0) terms.push(`${unread} no reading`);
  if (selected > 0) terms.push(`${selected} selected`);
  return ` ${terms.join(" · ")}`;
}

/** Grid rows at or above which the crew grid stands open; measured, shorter tiles push the launch control past the fold. */
const CREW_GRID_MIN_ROWS = 14;

/** The letterbox tile: wide enough for two readable columns, too short to stack them. */
const LETTERBOX_MIN_COLS = 14;
const LETTERBOX_MAX_ROWS = 6;

/** Trait and rank stay reachable on a row whose value line spent itself on the reason. */
export function crewChipTitle(k: CrewMember, reading: CrewReading): string {
  const who = `${k.trait || NULL_DISPLAY} · L${k.experienceLevel}`;
  if (reading === "available") return who;
  if (reading === "unavailable") return `${who} · ${k.unavailableReason}`;
  return `${who} · no availability reading`;
}

export interface LaunchSiteEntry {
  name: string;
  displayName: string;
  facility: string;
  body: string;
  ready: boolean;
  unlocked: boolean;
  /**
   * Whether a vessel is standing on this pad, `null` when this site reports no
   * occupancy at all. The mod reports occupancy for the stock VAB pad alone, so
   * every other site carries `null`, not a claim that it is clear.
   */
  occupied: boolean | null;
  /** The occupying vessel's name; `null` whenever {@link occupied} is not true. */
  occupantName: string | null;
}

/**
 * The editor a saved craft launches from, as `ksp.launch` spells it. Resolved
 * from the ORDINAL, never substituted with a default: a default in a dispatched
 * argument launches a spaceplane from the pad. An unknown ordinal passes the
 * raw name through so the mod refuses it visibly.
 */
function launchFacilityArg(ship: SavedShip): string {
  const resolved =
    ship.facilityOrdinal === null
      ? undefined
      : KSP_EDITOR_FACILITY_NAMES.get(ship.facilityOrdinal);
  // `None` is not an editor: let the mod refuse rather than choosing one on the player's behalf.
  if (resolved === undefined || resolved === "None") return ship.facility;
  return resolved;
}

/**
 * `Sitrep.Contract.VesselType`'s C# declared order: ordinal to display label.
 * Alignment with the SDK enum is locked by `../TargetPicker/enumLabelDrift.test.ts`.
 */
const VESSEL_TYPE_LABELS: readonly string[] = [
  "Ship",
  "Station",
  "Lander",
  "Probe",
  "Rover",
  "Base",
  "Relay",
  "EVA",
  "Flag",
  "Debris",
  "SpaceObject",
  "DeployedScienceController",
  "DeployedSciencePart",
  "DroppedPart",
  "Unknown",
];

/**
 * Parse `kc.launchSites`; null when the key is absent so the picker collapses.
 * Accepts the legacy `{ facility, body, ready, unlocked }` shape and the mod's
 * `LaunchSiteEntry` (`editorFacility`, `bodyIndex`, `isStock`). A new-shape
 * entry is selectable: the mod enumerates only sites available to launch from.
 */
export function parseLaunchSites(raw: unknown): LaunchSiteEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LaunchSiteEntry[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    // The mod entry has `editorFacility`/`isStock` and no legacy `unlocked` field.
    const isNewShape = !("unlocked" in e) && "editorFacility" in e;
    const facility =
      typeof e.facility === "string"
        ? e.facility
        : typeof e.editorFacility === "string"
          ? e.editorFacility
          : "";
    out.push({
      name,
      displayName:
        typeof e.displayName === "string" && e.displayName
          ? e.displayName
          : name,
      facility,
      body: typeof e.body === "string" ? e.body : "",
      ready: e.ready === true,
      unlocked: isNewShape ? true : e.unlocked === true,
      // Only a real boolean is an answer; anything else is a site that reported no occupancy.
      occupied: typeof e.padOccupied === "boolean" ? e.padOccupied : null,
      occupantName:
        typeof e.padVesselTitle === "string" && e.padVesselTitle
          ? e.padVesselTitle
          : null,
    });
  }
  return out;
}

/**
 * The pads, with the ones holding a REPORTED vessel first, stable otherwise.
 * An unreported pad keeps its place, so silence never outranks the stock pad
 * that answers.
 */
export function orderPads(
  sites: readonly LaunchSiteEntry[],
): LaunchSiteEntry[] {
  return [...sites].sort(
    (a, b) => (a.occupied === true ? 0 : 1) - (b.occupied === true ? 0 : 1),
  );
}

/** What a site's `EditorFacility` makes it, in the operator's words. */
function padKindLabel(facility: string): string {
  if (facility === "VAB") return "Pad";
  if (facility === "SPH") return "Runway";
  return facility || NULL_DISPLAY;
}

export function parseSavedShips(raw: unknown): SavedShip[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: SavedShip[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      partCount: magnitudeOr(asQuantityish(e.partCount), 0),
      totalMass: magnitudeOr(asQuantityish(e.totalMass), 0),
      facility: typeof e.facility === "string" ? e.facility : "",
      facilityOrdinal:
        typeof e.facilityOrdinal === "number" ? e.facilityOrdinal : null,
      requiresFunds: magnitudeOr(asQuantityish(e.requiresFunds), 0),
      missingParts: Array.isArray(e.missingParts)
        ? e.missingParts.filter((p): p is string => typeof p === "string")
        : [],
    });
  }
  return out;
}

export function parseCrew(raw: unknown): CrewMember[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: CrewMember[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOr(asQuantityish(e.experienceLevel), 0),
      available: typeof e.available === "boolean" ? e.available : null,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
    });
  }
  return out;
}

function LaunchDirectorComponent({
  h,
  w,
}: Readonly<ComponentProps<LaunchDirectorConfig>>) {
  /**
   * The pad's paperwork: craft files, the roster and unlocked sites change only
   * on events, so the last set received is still the answer.
   */
  const savedShipsRaw = stillTrue(
    useTelemetry("spaceCenter.savedShips"),
    undefined,
  );
  const crewRosterRaw = stillTrue(
    useTelemetry("spaceCenter.crewRoster"),
    undefined,
  );
  /**
   * The scene is a fact of the same kind, and it picks which panel renders: a
   * withheld scene would offer a launch while a vessel is up.
   */
  const sceneRecord = stillTrue(useTelemetry("spaceCenter.scene"), undefined);
  const launchSite = sceneRecord?.launchSite as string | undefined;
  // The raw per-site array, not `spaceCenter.state`, which collapses the list to the one entry carrying occupancy.
  const launchSitesRaw = stillTrue(
    useTelemetry("spaceCenter.launchSites"),
    undefined,
  );
  /**
   * The balance decides which craft are launchable, and that verdict is spent,
   * not read. Funds move while nobody looks, so a held balance is withheld.
   */
  const careerReading = useTelemetry("career.status");
  const careerEconomy =
    careerReading.state === "observed"
      ? careerReading.value.economy
      : undefined;
  const careerFunds = magnitudeOf(careerEconomy?.funds);
  // Separates a never-arrived balance from one no longer current, so a cold start does not accuse the link.
  const fundsNotCurrent = careerReading.state === "stale";
  // The standing rate the elected money model reports, beside the balance rather than folded into the gate; stock reports none.
  const netFunds = netFundsPerDay(careerEconomy);
  const { chargesFunds } = useGameContext();
  // The craft's name changes nowhere but the editor, so the last one received still names the vessel flying.
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const vesselName = identity?.name;
  // Off `vessel.flight`'s own field reading, which stays live on rails.
  const altitudeReading = useTelemetry("vessel.flight").altitudeAsl;
  const altitudeMeters = magnitudeOf(
    altitudeReading.reckoning.status === "available"
      ? altitudeReading.reckoning.modelled
      : altitudeReading.state === "observed"
        ? altitudeReading.value
        : undefined,
  );
  /**
   * The revert point is a capability the game grants and withdraws on events,
   * so a held one stands; each control is armed then confirmed anyway.
   */
  const revertAvailability = stillTrue(
    useTelemetry("ksp.revertAvailability"),
    undefined,
  );
  const canRevertToLaunch = revertAvailability?.canRevertToLaunch;
  const canRevertToEditor = revertAvailability?.canRevertToEditor;
  // Not in the SDK's typed Topic tail, so read through `useStream`.
  const crashHasRecent = stillTrue(
    useStream<boolean>("crash.hasRecent"),
    undefined,
  );
  /*
   * crash.hasRecent is session-wide, so the latest crash snapshot scopes the
   * recovery gate to the active vessel. A crash report stays true until the
   * next crash or a revert (the ut comparison below catches that).
   */
  const lastCrash = stillTrue(useTelemetry("crash.lastCrash"), undefined);
  // Stays an instant: its only use is the ordering against a crash snapshot's capture ut.
  const viewUt = useViewUt();
  // Elapsed mission time is the view clock measured from liftoff, absent until the clamps release: `launchUt` is null until then.
  const missionTime =
    identity?.launchUt == null || viewUt === undefined
      ? undefined
      : (magnitudeOf(viewUt.minus(identity.launchUt)) ?? undefined);
  /*
   * `target.available` already excludes the active vessel; only Vessel-kind
   * entries are switch targets. The roster is a fact, so the last one stands.
   */
  const targetAvailable = stillTrue(
    useTelemetry("target.available"),
    undefined,
  );
  const availableVessels = targetAvailable?.entries?.filter(
    (e) => e.kind === TargetKind.Vessel,
  );
  // LAUNCH is a delayed command to the pad; the other scene ops are KSC-desk actions at the meta-vantage.
  const launchCmd = useCommand("ksp.launch");
  const recoverCmd = useCommand("ksp.recover", { vantage: META_VANTAGE });
  const revertLaunchCmd = useCommand("ksp.revertToLaunch", {
    vantage: META_VANTAGE,
  });
  const revertEditorCmd = useCommand("ksp.revertToEditor", {
    vantage: META_VANTAGE,
  });
  const toTrackingCmd = useCommand("ksp.toTrackingStation", {
    vantage: META_VANTAGE,
  });
  const switchCmd = useCommand("ksp.switchVessel", { vantage: META_VANTAGE });
  usePanelDelay(launchCmd);
  usePanelDelay(recoverCmd);
  usePanelDelay(revertLaunchCmd);
  usePanelDelay(revertEditorCmd);
  usePanelDelay(toTrackingCmd);
  usePanelDelay(switchCmd);

  const boundPresses = useRef(new Map<LaunchDirectorActionId, Press>()).current;
  const pressBound =
    (id: LaunchDirectorActionId) => (payload: ActionInputPayload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      boundPresses.get(id)?.(true);
      return undefined;
    };
  useActionInput<LaunchDirectorActions>({
    launch: pressBound("launch"),
    recover: pressBound("recover"),
    revertToLaunch: pressBound("revertToLaunch"),
    revertToEditor: pressBound("revertToEditor"),
    trackingStation: pressBound("trackingStation"),
  });

  const ships = parseSavedShips(savedShipsRaw);
  const crew = parseCrew(crewRosterRaw);
  const launchSites = parseLaunchSites(launchSitesRaw);
  // Only sites the save can actually launch from, in the order the operator should read them: something on it first.
  const pads = useMemo(
    () => orderPads((launchSites ?? []).filter((s) => s.unlocked)),
    [launchSites],
  );

  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  // Which pad row is open; null means the first pad in prioritised order stands in. Derived, so a pad that leaves cannot leave a dead selection.
  const [pickedPad, setPickedPad] = useState<string | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const activePad = pads.find((p) => p.name === pickedPad) ?? pads[0];
  const selectedSite = activePad?.name ?? "";
  const scene = sceneRecord?.scene;

  // Absent funds are insufficient funds; sandbox and science charge nothing.
  const fundsAvailable = chargesFunds
    ? (careerFunds ?? 0)
    : Number.POSITIVE_INFINITY;
  /**
   * The craft this pad can take: a VAB craft from a pad, an SPH craft from a
   * runway, matched on the editor resolved from the ordinal. A site whose
   * facility is neither offers every craft, since hiding the fleet is a claim
   * we cannot make.
   */
  const padCraft =
    activePad === undefined || ships === null
      ? (ships ?? [])
      : activePad.facility === "VAB" || activePad.facility === "SPH"
        ? ships.filter((s) => launchFacilityArg(s) === activePad.facility)
        : ships;
  const occupiedPads = pads.filter((p) => p.occupied === true).length;
  const unreportedPads = pads.filter((p) => p.occupied === null).length;

  const rows = h ?? 9;
  const cols = w ?? 7;
  const showSubtitle = rows >= 4;
  const letterbox = cols >= LETTERBOX_MIN_COLS && rows <= LETTERBOX_MAX_ROWS;

  // Plain object, not a hook, so it can sit above the early return.
  const slotContext: LaunchDirectorSlotContext = {
    scene: scene ?? undefined,
    inFlight: scene === "Flight",
    selectedShip,
    selectedSite,
    selectedCrew: Array.from(selectedCrew),
    funds: careerFunds ?? undefined,
  };

  const inFlight = scene === "Flight";

  // The pads are the subject, so their absence is what empties the panel.
  if (launchSites === null && !inFlight) {
    return (
      <Panel
        panelTitle="LAUNCH & RECOVERY"
        compactTitle={["LAUNCH & REC", "LAUNCH"]}
        sections={
          showSubtitle ? (
            <Section full>
              <div
                role="status"
                style={{
                  fontSize: "var(--font-size-compact)",
                  color: "var(--color-text-faint)",
                }}
              >
                Awaiting launch-pad telemetry
              </div>
            </Section>
          ) : null
        }
      />
    );
  }

  const activeName = vesselName ?? activePad?.occupantName ?? "(unnamed)";
  /*
   * Recovery is crash-blocked only when the latest crash is the active
   * vessel's, falling back to the session-wide flag before the snapshot
   * arrives. A snapshot dated after the current UT belongs to a reverted
   * timeline.
   */
  const crashStale =
    lastCrash?.ut != null &&
    viewUt !== undefined &&
    lastCrash.ut.greaterThan(viewUt);
  const crashBlocked =
    !crashStale &&
    crashHasRecent === true &&
    (lastCrash == null
      ? true
      : typeof lastCrash.vesselName === "string" &&
        lastCrash.vesselName.length > 0 &&
        lastCrash.vesselName === vesselName);

  return (
    <BoundPresses.Provider value={boundPresses}>
      <Panel
        panelTitle="LAUNCH & RECOVERY"
        compactTitle={["LAUNCH & REC", "LAUNCH"]}
        sections={[
          showSubtitle ? (
            <Section key="summary" full>
              <div
                role="status"
                aria-live="polite"
                style={{
                  fontSize: "var(--font-size-compact)",
                  color: "var(--color-text-faint)",
                }}
              >
                {inFlight
                  ? `In flight: ${activeName}${launchSite && (w ?? 7) >= 6 ? ` · from ${launchSite}` : ""}`
                  : padSummary({
                      pads: pads.length,
                      occupied: occupiedPads,
                      unreported: unreportedPads,
                    })}
                {typeof careerFunds === "number" && (
                  <FundsReadout title="Available funds">
                    · <Unit value={value("funds", careerFunds)} />
                  </FundsReadout>
                )}
                {/* Not inside FundsReadout: that span is nowrap and would clip the drain. */}
                {reportsFundsDrain(netFunds) && (
                  <DrainReadout>
                    <FundsDrain
                      funds={careerFunds}
                      netPerDay={netFunds}
                      separator
                    />
                  </DrainReadout>
                )}
                {/* The balance is required beside a spend control; the two ways of having none say which. */}
                {careerFunds === null && chargesFunds && (
                  <FundsReadout
                    title={
                      fundsNotCurrent
                        ? "The last funds balance is no longer current, so affordability is not being judged"
                        : "No funds balance has arrived"
                    }
                  >
                    · {fundsNotCurrent ? "funds not current" : "funds unknown"}
                  </FundsReadout>
                )}
              </div>
            </Section>
          ) : null,
          <Section key="pads">
            {inFlight ? (
              <InFlightPanel
                missionTime={missionTime ?? null}
                altitudeMeters={altitudeMeters ?? null}
                canRevertToLaunch={canRevertToLaunch ?? false}
                canRevertToEditor={canRevertToEditor ?? false}
                crashBlocked={crashBlocked}
                availableVessels={availableVessels}
                recoverCmd={recoverCmd}
                revertLaunchCmd={revertLaunchCmd}
                revertEditorCmd={revertEditorCmd}
                toTrackingCmd={toTrackingCmd}
                switchCmd={switchCmd}
              />
            ) : (
              <PadSection
                pads={pads}
                activePad={activePad}
                onPickPad={(name) => {
                  setPickedPad(name);
                  setSelectedShip(null);
                  setSelectedCrew(new Set());
                }}
                padCraft={padCraft}
                craftKnown={ships !== null}
                crew={crew}
                selectedShip={selectedShip}
                onSelectShip={(name) => {
                  setSelectedShip(name);
                  setSelectedCrew(new Set());
                }}
                selectedCrew={selectedCrew}
                onToggleCrew={(name) =>
                  setSelectedCrew((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) next.delete(name);
                    else next.add(name);
                    return next;
                  })
                }
                fundsAvailable={fundsAvailable}
                funds={careerFunds ?? undefined}
                rows={rows}
                letterbox={letterbox}
                launchCmd={launchCmd}
                recoverCmd={recoverCmd}
                revertEditorCmd={revertEditorCmd}
                slotContext={slotContext}
              />
            )}
          </Section>,
        ]}
      />
    </BoundPresses.Provider>
  );
}

/** The subtitle's account of the pads; every pad silent about occupancy is not every pad clear. */
function padSummary({
  pads,
  occupied,
  unreported,
}: {
  pads: number;
  occupied: number;
  unreported: number;
}): string {
  if (pads === 0) return "No pads";
  const label = `${pads} pad${pads === 1 ? "" : "s"}`;
  if (unreported === pads) return `${label} · occupancy unreported`;
  // "all clear" needs every pad to have answered; otherwise it is a count of those that did.
  const parts = [label];
  if (occupied > 0) parts.push(`${occupied} occupied`);
  else if (unreported === 0) parts.push("all clear");
  else parts.push(`${pads - unreported} clear`);
  if (unreported > 0) parts.push(`${unreported} unreported`);
  return parts.join(" · ");
}

/** What is standing on this pad, including the case where nobody said. */
function occupancyText(site: LaunchSiteEntry): string {
  if (site.occupied === true)
    return `On pad: ${site.occupantName ?? NULL_DISPLAY}`;
  if (site.occupied === false) return "Clear";
  return "Occupancy unreported";
}

/**
 * The pads, and what the operator can do with the one they have opened. A pad
 * an Uplink knows more about says so through `launch-director.pad`; an open
 * pad's picker is the craft list narrowed to this site's editor.
 */
function PadSection({
  pads,
  activePad,
  onPickPad,
  padCraft,
  craftKnown,
  crew,
  selectedShip,
  onSelectShip,
  selectedCrew,
  onToggleCrew,
  fundsAvailable,
  funds,
  rows,
  letterbox,
  launchCmd,
  recoverCmd,
  revertEditorCmd,
  slotContext,
}: {
  pads: readonly LaunchSiteEntry[];
  activePad: LaunchSiteEntry | undefined;
  onPickPad: (name: string) => void;
  padCraft: readonly SavedShip[];
  /** False while the saved-craft list has never arrived, which is not an empty pad. */
  craftKnown: boolean;
  crew: CrewMember[] | null;
  selectedShip: string | null;
  onSelectShip: (name: string | null) => void;
  selectedCrew: ReadonlySet<string>;
  onToggleCrew: (name: string) => void;
  fundsAvailable: number;
  funds: number | undefined;
  /** The tile's height in grid rows; decides whether the crew grid stands open. */
  rows: number;
  /** Wide and short, so the pad's craft and crew sit side by side. */
  letterbox: boolean;
  launchCmd: CommandButtonHandle;
  recoverCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  slotContext: LaunchDirectorSlotContext;
}) {
  const ship = selectedShip
    ? padCraft.find((s) => s.name === selectedShip)
    : undefined;
  /**
   * The selection minus anyone the roster no longer calls available: the mod
   * skips a name it cannot seat without refusing, so "(3 crew)" could fly two.
   */
  const manifest = (crew ?? [])
    .filter((k) => crewReading(k) === "available" && selectedCrew.has(k.name))
    .map((k) => k.name);

  return (
    <>
      <SectionLabel>Pads</SectionLabel>
      {pads.length === 0 ? (
        <EmptyNote>No launch sites reported</EmptyNote>
      ) : (
        <PadList>
          {pads.map((site) => {
            const expanded = site.name === activePad?.name;
            return (
              <PadCard key={site.name}>
                <PadRowButton
                  type="button"
                  data-pad-row
                  $selected={expanded}
                  aria-pressed={expanded}
                  onClick={() => onPickPad(site.name)}
                >
                  <PadMeta>
                    <PadName>{site.displayName}</PadName>
                    <PadDetails>
                      {padKindLabel(site.facility)}
                      {site.body && site.body !== "Kerbin"
                        ? ` · ${site.body}`
                        : ""}
                    </PadDetails>
                  </PadMeta>
                  <PadOccupancy $occupied={site.occupied}>
                    {occupancyText(site)}
                  </PadOccupancy>
                </PadRowButton>
                <PadAside>
                  <AugmentSlot
                    name="launch-director.pad"
                    props={{
                      siteName: site.name,
                      displayName: site.displayName,
                      editorFacility: site.facility,
                      occupied: site.occupied,
                      occupantName: site.occupantName,
                      expanded,
                      funds,
                    }}
                  />
                </PadAside>
                {expanded && (
                  <PadDetail>
                    {site.occupied === true ? (
                      /* Both commands act on the one vessel KSP has at PRELAUNCH. */
                      <PadActions>
                        <ArmedButton
                          bindAs="recover"
                          kind="recover"
                          handle={recoverCmd}
                          commandLabel="Recover"
                          label="Recover"
                          confirmLabel="Confirm recover"
                          pendingLabel="Recovering..."
                        />
                        {/* Reverts to VAB: the widget cannot tell which editor the pad's craft came from. */}
                        <ArmedButton
                          bindAs="revertToEditor"
                          kind="revert"
                          handle={revertEditorCmd}
                          args={{ editor: "vab" }}
                          commandLabel="Revert to VAB"
                          label="Revert to VAB"
                          confirmLabel="Confirm revert"
                          pendingLabel="Reverting..."
                        />
                      </PadActions>
                    ) : !craftKnown ? (
                      <EmptyNote>Awaiting saved-craft telemetry</EmptyNote>
                    ) : padCraft.length === 0 ? (
                      <EmptyNote>
                        No saved craft for this{" "}
                        {padKindLabel(site.facility).toLowerCase()}
                      </EmptyNote>
                    ) : (
                      <CraftAndCrew $sideBySide={letterbox && ship != null}>
                        <PadColumn>
                          <SectionLabel>
                            Craft ·{" "}
                            {
                              padCraft.filter(
                                (s) =>
                                  s.missingParts.length === 0 &&
                                  s.requiresFunds <= fundsAvailable,
                              ).length
                            }
                            /{padCraft.length} ready
                          </SectionLabel>
                          <ShipList>
                            {padCraft.map((s) => {
                              const blocked =
                                s.missingParts.length > 0 ||
                                s.requiresFunds > fundsAvailable;
                              return (
                                <ShipRow
                                  key={`${s.facility}/${s.name}`}
                                  type="button"
                                  data-ship-row
                                  $selected={selectedShip === s.name}
                                  $blocked={blocked}
                                  aria-pressed={selectedShip === s.name}
                                  aria-disabled={blocked}
                                  onClick={() => {
                                    if (blocked) return;
                                    onSelectShip(
                                      selectedShip === s.name ? null : s.name,
                                    );
                                  }}
                                >
                                  <ShipMeta>
                                    <ShipName>{s.name}</ShipName>
                                    <ShipDetails>
                                      {s.partCount} parts ·{" "}
                                      <Unit
                                        value={value("t", s.totalMass)}
                                        decimals={1}
                                      />
                                    </ShipDetails>
                                  </ShipMeta>
                                  <ShipCost>
                                    {/* One Unit carrying the value, so the cost groups like the balance. */}
                                    {s.requiresFunds > fundsAvailable && (
                                      <BlockedTag title="Insufficient funds">
                                        <Unit
                                          value={value(
                                            "funds",
                                            s.requiresFunds,
                                          )}
                                        />
                                      </BlockedTag>
                                    )}
                                    {s.requiresFunds <= fundsAvailable &&
                                      s.requiresFunds > 0 && (
                                        <CostTag>
                                          <Unit
                                            value={value(
                                              "funds",
                                              s.requiresFunds,
                                            )}
                                          />
                                        </CostTag>
                                      )}
                                    {s.missingParts.length > 0 && (
                                      <BlockedTag
                                        title={`Missing: ${s.missingParts.join(", ")}`}
                                      >
                                        {s.missingParts.length} locked
                                      </BlockedTag>
                                    )}
                                  </ShipCost>
                                </ShipRow>
                              );
                            })}
                          </ShipList>
                        </PadColumn>

                        {ship && (
                          <PadColumn>
                            {crew === null ? (
                              <>
                                <SectionLabel>Crew</SectionLabel>
                                {/* The roster's own absence, said out loud; nothing to fold, so no expander. */}
                                <ReadoutCaption>
                                  Roster: no reading
                                </ReadoutCaption>
                              </>
                            ) : (
                              /* The tally is the expander's own label; `key` re-seats the fold when a resize crosses the threshold. */
                              <CrewDisclosure
                                key={
                                  rows >= CREW_GRID_MIN_ROWS ? "open" : "folded"
                                }
                                variant="inline"
                                panelHeight="auto"
                                defaultOpen={rows >= CREW_GRID_MIN_ROWS}
                                label={
                                  <SectionLabel>
                                    Crew
                                    {crewTally(crew, manifest.length)}
                                  </SectionLabel>
                                }
                              >
                                <CrewGrid $compact={rows < CREW_GRID_MIN_ROWS}>
                                  {crew.map((k) => {
                                    const reading = crewReading(k);
                                    const selectable = reading === "available";
                                    return (
                                      <CrewChip
                                        key={k.name}
                                        type="button"
                                        /* Named, so a render scene can select a specific kerbal. */
                                        data-crew-chip={k.name}
                                        $selected={selectedCrew.has(k.name)}
                                        $disabled={!selectable}
                                        $compact={rows < CREW_GRID_MIN_ROWS}
                                        aria-disabled={!selectable}
                                        aria-pressed={selectedCrew.has(k.name)}
                                        title={crewChipTitle(k, reading)}
                                        onClick={() => {
                                          if (!selectable) return;
                                          onToggleCrew(k.name);
                                        }}
                                      >
                                        <CrewName>{k.name}</CrewName>
                                        {/* The reason is a fact off the wire and belongs on screen. */}
                                        <CrewTrait>
                                          {reading === "available"
                                            ? `${k.trait || NULL_DISPLAY} L${k.experienceLevel}`
                                            : reading === "unavailable"
                                              ? k.unavailableReason
                                              : "no reading"}
                                        </CrewTrait>
                                      </CrewChip>
                                    );
                                  })}
                                </CrewGrid>
                              </CrewDisclosure>
                            )}
                            <LaunchControls>
                              <ArmedButton
                                bindAs="launch"
                                kind="launch"
                                handle={launchCmd}
                                args={{
                                  shipName: ship.name,
                                  facility: launchFacilityArg(ship),
                                  site: site.name,
                                  crew: manifest,
                                }}
                                commandLabel={`Launch ${ship.name}`}
                                label={
                                  manifest.length > 0
                                    ? `Launch ${ship.name} (${manifest.length} crew)`
                                    : `Launch ${ship.name} unmanned`
                                }
                                confirmLabel="Confirm launch"
                                pendingLabel="Launching..."
                              />
                            </LaunchControls>
                          </PadColumn>
                        )}
                      </CraftAndCrew>
                    )}
                  </PadDetail>
                )}
              </PadCard>
            );
          })}
        </PadList>
      )}
      {/* Pre-launch checklist augments. */}
      <AugmentSlot name="launch-director.preflight" props={slotContext} />
    </>
  );
}
function InFlightPanel({
  missionTime,
  altitudeMeters,
  canRevertToLaunch,
  canRevertToEditor,
  crashBlocked,
  availableVessels,
  recoverCmd,
  revertLaunchCmd,
  revertEditorCmd,
  toTrackingCmd,
  switchCmd,
}: {
  missionTime: number | null;
  altitudeMeters: number | null;
  canRevertToLaunch: boolean;
  canRevertToEditor: boolean;
  crashBlocked: boolean;
  availableVessels: TargetListEntry[] | undefined;
  /** The handles: each control holds its own arm and in-flight state off the one it is given. */
  recoverCmd: CommandButtonHandle;
  revertLaunchCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  toTrackingCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
}) {
  const [switchOpen, setSwitchOpen] = useState(false);
  // The mod saves first and refuses when KSP will not, so this control keeps its own chrome to name the refusal.
  const trackingStation = useCommandButton({
    handle: toTrackingCmd,
    commandLabel: "Go to Tracking Station",
  });
  useBindPress(
    "trackingStation",
    trackingStation.press,
    !trackingStation.isPending,
  );
  const trackingStationLoss = commandLossSentence({
    label: "Go to Tracking Station",
  });
  const [showSpaceObjects, setShowSpaceObjects] = useState(false);
  const totalAvailable = availableVessels?.length ?? 0;
  const spaceObjectCount = useMemo(
    () =>
      (availableVessels ?? []).filter(
        (e) => e.vesselType === VesselType.SpaceObject,
      ).length,
    [availableVessels],
  );
  const switchableVessels = useMemo(() => {
    const entries = availableVessels ?? [];
    // SpaceObjects (asteroids, comets) are hidden unless the toggle reveals them.
    const list = showSpaceObjects
      ? entries
      : entries.filter((e) => e.vesselType !== VesselType.SpaceObject);
    return [...list].sort((a, b) => {
      const da = magnitudeOf(a.distance) ?? Number.POSITIVE_INFINITY;
      const db = magnitudeOf(b.distance) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [availableVessels, showSpaceObjects]);
  return (
    <InFlightWrap>
      {crashBlocked && (
        <CrashChip role="status">
          Crash in progress: return to Space Center to recover
        </CrashChip>
      )}
      <FlightStats>
        <FlightStatRow>
          <StatLabel>Mission time</StatLabel>
          <StatValue>{formatMissionTime(missionTime)}</StatValue>
        </FlightStatRow>
        <FlightStatRow>
          <StatLabel>Altitude</StatLabel>
          <StatValue>{<Altitude m={altitudeMeters} />}</StatValue>
        </FlightStatRow>
      </FlightStats>
      <PadActions>
        <ArmedButton
          bindAs="recover"
          kind="recover"
          handle={recoverCmd}
          commandLabel="Recover"
          label="Recover"
          confirmLabel="Confirm recover"
          pendingLabel="Recovering..."
          disabled={crashBlocked}
        />
        <ArmedButton
          bindAs="revertToLaunch"
          kind="revert"
          handle={revertLaunchCmd}
          commandLabel="Revert to launch"
          label={
            canRevertToLaunch ? "Revert to launch" : "Revert to launch (n/a)"
          }
          confirmLabel="Confirm revert to launch"
          pendingLabel="Reverting..."
          disabled={!canRevertToLaunch}
        />
        <ArmedButton
          bindAs="revertToEditor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label={canRevertToEditor ? "Revert to VAB" : "Revert to VAB (n/a)"}
          confirmLabel="Confirm revert to VAB"
          pendingLabel="Reverting..."
          disabled={!canRevertToEditor}
        />
        {trackingStation.isPending ? (
          <TrackingStationConfirm type="button" disabled aria-busy="true">
            <Spinner size={12} /> Leaving...
          </TrackingStationConfirm>
        ) : trackingStation.isArmed ||
          trackingStation.isRefused ||
          trackingStation.isLost ? (
          <TrackingStationConfirm
            type="button"
            onClick={() => trackingStation.press(true)}
            title={
              trackingStation.refusalText ??
              (trackingStation.isLost
                ? trackingStationLoss
                : "Saves the game, then leaves. Refused, naming KSP's own reason, when KSP will not save here.")
            }
            aria-label={
              trackingStation.refusalText ??
              (trackingStation.isLost ? trackingStationLoss : undefined)
            }
          >
            {trackingStation.isRefused
              ? "Refused"
              : trackingStation.isLost
                ? "No reply"
                : "Confirm: save and leave"}
          </TrackingStationConfirm>
        ) : (
          <TrackingStationButton
            type="button"
            onClick={() => trackingStation.press(true)}
            title="Tracking Station: saves the game first, and refuses if KSP will not save here"
          >
            Tracking Station
          </TrackingStationButton>
        )}
        <TrackingStationButton
          type="button"
          disabled={totalAvailable === 0}
          aria-expanded={switchOpen}
          aria-haspopup="listbox"
          onClick={() => setSwitchOpen((v) => !v)}
          title={
            totalAvailable === 0
              ? "No other vessels in this save"
              : `Switch to one of ${totalAvailable} other vessel${totalAvailable === 1 ? "" : "s"}`
          }
        >
          Switch to vessel ▾
        </TrackingStationButton>
      </PadActions>
      {switchOpen && totalAvailable > 0 && (
        <VesselSwitchPanel role="listbox" aria-label="Switch active vessel">
          {spaceObjectCount > 0 && (
            <SpaceObjectToggle
              type="button"
              aria-pressed={showSpaceObjects}
              onClick={() => setShowSpaceObjects((v) => !v)}
              title={
                showSpaceObjects
                  ? "Hide asteroids / comets from the list"
                  : "Show asteroids / comets in the list"
              }
            >
              {showSpaceObjects
                ? `Asteroids: shown (${spaceObjectCount})`
                : `Asteroids: hidden (${spaceObjectCount})`}
            </SpaceObjectToggle>
          )}
          {switchableVessels.length === 0 ? (
            <VesselSwitchHint>No other vessels to show.</VesselSwitchHint>
          ) : (
            switchableVessels.map((entry) => (
              <VesselSwitchRow
                key={entry.vesselId ?? entry.name}
                type="button"
                onClick={() => {
                  if (!entry.vesselId) return;
                  setSwitchOpen(false);
                  void switchCmd.send({ vesselId: entry.vesselId });
                }}
              >
                <VesselSwitchName>
                  <span>{entry.name}</span>
                  <VesselSwitchMeta>
                    {VESSEL_TYPE_LABELS[entry.vesselType ?? -1] ?? "Unknown"}
                  </VesselSwitchMeta>
                </VesselSwitchName>
                <VesselSwitchDistance>
                  <Altitude m={magnitudeOf(entry.distance)} />
                </VesselSwitchDistance>
              </VesselSwitchRow>
            ))
          )}
        </VesselSwitchPanel>
      )}
    </InFlightWrap>
  );
}

function formatMissionTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return NULL_DISPLAY;
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `T+${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `T+${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// Through the shared `length` ladder, so a Mun transfer reads in Mm.
function Altitude({ m }: { m: number | null }) {
  if (m === null) return NULL_DISPLAY;
  return <Unit value={value("m", m)} />;
}

/**
 * The pad/flight action button. Behaviour is the shared `useCommandButton`;
 * the chrome is local because each verb carries its own colour. Every button
 * carries a pending state, for idempotency and honesty alike.
 */
function ArmedButton({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  kind,
  disabled,
  pendingLabel,
  bindAs,
}: {
  handle: CommandButtonHandle;
  args?: unknown;
  commandLabel?: string;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
  disabled?: boolean;
  pendingLabel?: string;
  /** The action that presses this control from a bound input. */
  bindAs?: LaunchDirectorActionId;
}) {
  const {
    isArmed,
    isPending,
    isRefused,
    isLost,
    refusalText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel });
  // Mirrors which render takes a click: pending never, refused and lost always, the rest unless disabled.
  useBindPress(
    bindAs,
    press,
    !isPending && (isRefused || isLost || disabled !== true),
  );

  if (isPending) {
    return (
      <ConfirmButton type="button" $kind={kind} disabled aria-busy="true">
        <Spinner size={12} /> {pendingLabel ?? "Working..."}
      </ConfirmButton>
    );
  }
  if (isRefused) {
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={refusalText ?? undefined}
        aria-label={refusalText ?? undefined}
        data-launch-action={`refused-${kind}`}
      >
        Refused
      </ConfirmButton>
    );
  }
  if (isLost) {
    // Not the resting render: a recover or revert nobody answered may already have happened.
    const sentence = commandLossSentence({ label: commandLabel });
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={sentence}
        aria-label={sentence}
        data-launch-action={`lost-${kind}`}
      >
        No reply
      </ConfirmButton>
    );
  }
  if (isArmed) {
    return (
      <ConfirmButton
        type="button"
        onClick={() => press(true)}
        $kind={kind}
        disabled={disabled}
        data-launch-action={`confirm-${kind}`}
      >
        {confirmLabel}
      </ConfirmButton>
    );
  }
  return (
    <ArmButton
      type="button"
      onClick={() => press(true)}
      $kind={kind}
      disabled={disabled}
      data-failed={hasFailure ? "true" : undefined}
      data-launch-action={`arm-${kind}`}
    >
      {label}
    </ArmButton>
  );
}

const SectionLabel = styled.div`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: var(--gap-caption);
`;

const PadList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PadCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const PadRowButton = styled.button<{ $selected: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${(p) =>
      p.$selected ? "var(--color-accent-fg)" : "var(--color-surface-raised)"};
  border-radius: var(--radius-regular);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const PadMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

const PadName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const PadDetails = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

// Unreported reads as a caution, so silence is never read as an empty pad.
const PadOccupancy = styled.span<{ $occupied: boolean | null }>`
  font-size: var(--font-size-compact);
  flex-shrink: 0;
  text-align: right;
  color: ${(p) =>
    p.$occupied === true
      ? "var(--color-status-go-fg)"
      : p.$occupied === null
        ? "var(--color-text-muted)"
        : "var(--color-text-faint)"};
`;

// Indented and one step down in size, so six pads with asides still read as a list.
const PadAside = styled.div`
  padding-left: var(--indent-aside);
  font-size: var(--font-size-compact);
  &:empty {
    display: none;
  }
`;

const PadDetail = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding-left: var(--indent-aside);
  border-left: 2px solid var(--color-surface-raised);
`;

// One track normally, two in a letterbox once a craft is picked; `align-items: start` keeps the crew column its own height.
const CraftAndCrew = styled.div<{ $sideBySide: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$sideBySide ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)"};
  align-items: start;
  gap: var(--gap-related);
`;

const PadColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
`;

const EmptyNote = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;
// Not a list: `<button>` is not a valid child of `<ul>`.
const ShipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ShipRow = styled.button<{ $selected: boolean; $blocked: boolean }>`
  display: flex;
  justify-content: space-between;
  /* Pins the cost tag to the first line of a wrapped ship name. */
  align-items: flex-start;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "var(--color-surface-panel)"};
  border: 1px solid
    ${(p) =>
      p.$selected ? "var(--color-accent-fg)" : "var(--color-surface-raised)"};
  border-radius: var(--radius-regular);
  cursor: ${(p) => (p.$blocked ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$blocked ? 0.55 : 1)};
  text-align: left;
  font-family: inherit;
`;

const ShipMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

const ShipName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ShipDetails = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

const ShipCost = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  flex-shrink: 0;
`;

const CostTag = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BlockedTag = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-status-nogo-fg);
  font-variant-numeric: tabular-nums;
`;

// Sits in the CRAFT column like a heading, so the trigger's UA centring and padding are undone.
const CrewDisclosure = styled(Disclosure)`
  > button {
    padding-left: 0;
    text-align: left;
  }
  /* A section that folds, not a row that pops open, so the accordion chrome comes off. */
  > [role="group"] {
    padding: 0;
    background: none;
    border: none;
  }
`;

const CrewGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(${(p) => (p.$compact ? "170px" : "120px")}, 1fr)
  );
  gap: var(--gap-related);
`;

// Compact puts name and reason on one line; the reason is never truncated, so the compact track is wider.
const CrewChip = styled.button<{
  $selected: boolean;
  $disabled: boolean;
  $compact: boolean;
}>`
  display: flex;
  flex-direction: ${(p) => (p.$compact ? "row" : "column")};
  flex-wrap: wrap;
  align-items: ${(p) => (p.$compact ? "baseline" : "flex-start")};
  gap: ${(p) => (p.$compact ? "var(--gap-value-tag)" : "var(--gap-line)")};
  padding: var(--inset-surface);
  background: ${(p) =>
    p.$selected ? "var(--color-status-go-bg)" : "var(--color-surface-panel)"};
  color: ${(p) =>
    p.$selected ? "var(--color-status-go-fg)" : "var(--color-text-primary)"};
  border: 1px solid
    ${(p) => (p.$selected ? "transparent" : "var(--color-surface-raised)")};
  border-radius: var(--radius-regular);
  cursor: ${(p) => (p.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
  text-align: left;
  font-family: inherit;
`;

const CrewName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
`;

const CrewTrait = styled.span`
  font-size: var(--font-size-compact);
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

const LaunchControls = styled.div`
  display: flex;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
`;

const PadActions = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const InFlightWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const FlightStats = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const FlightStatRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-row-wrap) var(--gap-label-value);
  /* A narrow widget drops the value onto its own line rather than clipping it. */
  flex-wrap: wrap;
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
  background: var(--color-surface-panel);
`;

const StatLabel = styled.dt`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  margin: 0;
`;

const StatValue = styled.dd`
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-weight: 600;
  white-space: nowrap;
  margin-left: auto;
`;

const CrashChip = styled.div`
  background: var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-compact);
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  letter-spacing: 0.04em;
`;

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
  /* Keeps the middot with the amount when the subtitle wraps. */
  white-space: nowrap;
`;

// Not FundsReadout: the drain manages its own break opportunities and must wrap.
const DrainReadout = styled.span`
  margin-left: var(--gap-lead-figure);
`;

const armButtonBase = `
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--color-surface-raised);
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  justify-content: center;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
`;

const ArmButton = styled.button<{ $kind: "launch" | "recover" | "revert" }>`
  ${armButtonBase}
  background: ${(p) =>
    p.$kind === "launch" ? "var(--color-status-go-bg)" : "transparent"};
  color: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-fg)"
      : "var(--color-text-muted)"};
  border-color: ${(p) =>
    p.$kind === "launch" ? "transparent" : "var(--color-surface-raised)"};

  &:hover {
    filter: brightness(1.1);
  }
`;

const TrackingStationButton = styled.button`
  ${armButtonBase}
  background: transparent;
  color: var(--color-status-info-fg);
  border-color: var(--color-surface-raised);

  &:hover {
    filter: brightness(1.1);
    border-color: var(--color-status-info-fg);
  }
`;

const TrackingStationConfirm = styled.button`
  ${armButtonBase}
  background: var(--color-status-warning-bg-muted);
  color: var(--color-status-warning-fg-muted);
  border-color: var(--color-status-warning-border-muted);

  &:hover {
    filter: brightness(1.1);
  }
`;

const VesselSwitchPanel = styled.div`
  margin-top: var(--gap-related-compact);
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--color-surface-raised);
  border-radius: var(--radius-regular);
  background: var(--color-surface-app);
  padding: var(--inset-switch-panel);
`;

const VesselSwitchRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: transparent;
  color: var(--color-text-primary);
  border: none;
  border-radius: var(--radius-regular);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: var(--font-size-compact);

  &:hover {
    background: var(--color-surface-panel);
  }
  &:focus-visible {
    /* An inset ring: the overflow-y scroller above would clip an outset one. */
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const VesselSwitchName = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const VesselSwitchMeta = styled.span`
  font-size: var(--font-size-caption);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VesselSwitchDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--gap-trailing-figure);
`;

const VesselSwitchHint = styled.div`
  padding: var(--inset-surface);
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

/** Asteroid/comet visibility toggle, hidden by default; the count-carrying label is the reveal button. */
const SpaceObjectToggle = styled.button`
  align-self: flex-start;
  margin: var(--outset-reveal-toggle);
  font-size: var(--font-size-compact);
  padding: var(--inset-control);
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  letter-spacing: 0.04em;
  font-family: inherit;
  &[aria-pressed="true"] {
    color: var(--color-status-info-fg);
    border-color: var(--color-status-info-fg);
  }
  &:hover {
    filter: brightness(1.15);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ConfirmButton = styled.button<{
  $kind: "launch" | "recover" | "revert";
}>`
  ${armButtonBase}
  background: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-bg)"
      : "var(--color-status-nogo-bg)"};
  color: ${(p) =>
    p.$kind === "launch"
      ? "var(--color-status-go-fg)"
      : "var(--color-status-nogo-fg)"};
  border-color: transparent;
  /* The animation lives inside the same reduced-motion guard as its keyframes. */
  @media (prefers-reduced-motion: no-preference) {
    animation: armedPulse 1s var(--ease-emphasis) infinite;
    @keyframes armedPulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

registerComponent<LaunchDirectorConfig>({
  id: "launch-director",
  name: "Launch & Recovery",
  description:
    "Every launch pad across the space centre, the ones with something standing on them first, and what you can do from the one you open: launch a craft and crew from it, or recover and revert what is already there. Greyed-out craft are blocked by funds or missing tech; a kerbal who cannot fly is greyed out and says why, or reads as no reading where the roster carried no availability. Buttons that fire a launch or recovery always confirm before sending the action.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  augmentSlots: ["launch-director.pad", "launch-director.preflight"],
  dataRequirements: [
    "spaceCenter.savedShips",
    "spaceCenter.crewRoster",
    "spaceCenter.launchSites",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "career.status.economy.funds",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
    "vessel.identity.name",
    "vessel.identity.launchUt",
    "vessel.flight.altitudeAsl",
    "ksp.revertAvailability.canRevertToLaunch",
    "ksp.revertAvailability.canRevertToEditor",
    "crash.hasRecent",
    "crash.lastCrash",
    "target.available",
  ],
  defaultConfig: {},
  actions: launchDirectorActions,
  pushable: true,
});

// Aliased for `../TargetPicker/enumLabelDrift.test.ts`, since TargetPicker declares its own `VESSEL_TYPE_LABELS`.
export {
  LaunchDirectorComponent,
  VESSEL_TYPE_LABELS as LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS,
};
